import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../server/db.ts';
import { createApp } from '../server/app.ts';
import { config } from '../server/config.ts';
import {
  currentChatService,
  currentEmbeddingService,
  currentVisionService,
  modelBase,
  withOwnerModel,
} from '../server/services/model-settings.ts';
import { embeddings, describePage } from '../server/services/ai.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyu-service-settings-'));
config.dataDir = dir;
config.publicOrigin = '';
config.llm = { base: '', key: '', model: '' };
const db = openDatabase(path.join(dir, 'test.sqlite'));
const { app } = createApp(db, { processDocuments: false, party: false });
const server = http.createServer(app);
let base = '',
  upstreamStatus = 200;
const calls: { url: string; authorization: string; body: any }[] = [];
const upstream = http.createServer(async (req, res) => {
  const parts: Buffer[] = [];
  for await (const part of req) parts.push(Buffer.from(part));
  const body = JSON.parse(Buffer.concat(parts).toString());
  calls.push({ url: req.url!, authorization: req.headers.authorization || '', body });
  res.writeHead(upstreamStatus, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify(
      req.url === '/v1/embeddings'
        ? { data: body.input.map((_: unknown, index: number) => ({ index, embedding: [1, 0, 0] })) }
        : { choices: [{ message: { content: '这是一张白色图片。' } }] },
    ),
  );
});
function client() {
  let cookie = '';
  return {
    get owner() {
      return cookie.split('=')[1];
    },
    async call(route: string, method = 'GET', body?: unknown) {
      const response = await fetch(`${base}/api${route}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      cookie = response.headers.get('set-cookie')?.split(';')[0] || cookie;
      return { status: response.status, body: await response.json() };
    },
  };
}
const a = client(),
  b = client();
before(async () => {
  await Promise.all([
    new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)),
    new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve)),
  ]);
  base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  const address = `http://127.0.0.1:${(upstream.address() as import('node:net').AddressInfo).port}/v1`;
  // Accept the exact endpoint syntax that caused the deployment failure.
  config.embedding = { base: `${address}/embeddings`, key: 'site-vector-key', model: 'site-vector' };
  config.vision = { base: `${address}/chat/completions`, key: 'site-vision-key', model: 'site-vision' };
  await Promise.all([a.call('/bootstrap'), b.call('/bootstrap')]);
});
after(async () => {
  await Promise.all([
    new Promise<void>((r) => server.close(() => r())),
    new Promise<void>((r) => upstream.close(() => r())),
  ]);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('站点完整接口地址不会重复拼接；连接测试实际发送向量与图片请求', async () => {
  assert.equal(modelBase(' https://api.siliconflow.cn/v1/embeddings/ '), 'https://api.siliconflow.cn/v1');
  for (const kind of ['embedding', 'vision']) {
    assert.equal((await a.call(`/model-settings/${kind}`)).body.siteConfigured, true);
    const tested = await a.call(`/model-settings/${kind}/test`, 'POST', {});
    assert.equal(tested.status, 200);
    if (kind === 'embedding') {
      assert.equal(tested.body.dimensions, 3);
      assert.equal(calls.at(-1)!.url, '/v1/embeddings');
      assert.equal(calls.at(-1)!.authorization, 'Bearer site-vector-key');
      assert.deepEqual(calls.at(-1)!.body.input, ['知屿连接测试']);
    } else {
      assert.equal(calls.at(-1)!.url, '/v1/chat/completions');
      assert.equal(calls.at(-1)!.authorization, 'Bearer site-vision-key');
      assert.match(calls.at(-1)!.body.messages[1].content[0].image_url.url, /^data:image\/png;base64,/);
    }
  }
  assert.deepEqual(await embeddings(['first', 'second']), [
    [1, 0, 0],
    [1, 0, 0],
  ]);
  assert.ok(await describePage(Buffer.from('fixture')));
  upstreamStatus = 401;
  try {
    const failed = await a.call('/model-settings/embedding/test', 'POST', {});
    assert.equal(failed.status, 502);
    assert.match(JSON.stringify(failed.body), /401/);
  } finally {
    upstreamStatus = 200;
  }
});

test('个人 Embedding 与视觉设置独立加密、按学习空间隔离，空 Key 保留并规范化地址', async () => {
  for (const kind of ['embedding', 'vision'] as const) {
    const key = `sk-fixture-${kind}`;
    const suffix = kind === 'embedding' ? 'embeddings' : 'chat/completions';
    const saved = await a.call(`/model-settings/${kind}`, 'PUT', {
      mode: 'personal',
      base: `https://api.example.com/v1/${suffix}`,
      model: `personal-${kind}`,
      key,
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.base, 'https://api.example.com/v1');
    assert.equal(saved.body.hasKey, true);
    assert.ok(!JSON.stringify(saved.body).includes(key));
    const raw = db.get<{ secret: string }>(
      'SELECT secret FROM service_model_settings WHERE owner=? AND kind=?',
      a.owner,
      kind,
    )!.secret;
    assert.ok(raw && !raw.includes(key));
    assert.equal((await b.call(`/model-settings/${kind}`)).body.hasKey, false);
    const again = await a.call(`/model-settings/${kind}`, 'PUT', {
      mode: 'personal',
      model: `personal-${kind}`,
      key: '',
    });
    assert.equal(again.status, 200);
    assert.equal(
      db.get<{ secret: string }>(
        'SELECT secret FROM service_model_settings WHERE owner=? AND kind=?',
        a.owner,
        kind,
      )!.secret,
      raw,
    );
    assert.equal(
      (
        await a.call(`/model-settings/${kind}`, 'PUT', {
          mode: 'personal',
          base: 'https://other.example.com/v1',
        })
      ).status,
      422,
    );
    assert.equal(
      (
        await a.call(`/model-settings/${kind}`, 'PUT', {
          mode: 'personal',
          base: 'https://127.0.0.1/v1',
          key,
        })
      ).status,
      422,
    );
  }
  assert.equal((await a.call('/model-settings')).body.hasKey, false);
  const capabilities = (await a.call('/bootstrap')).body.capabilities;
  assert.equal(capabilities.embeddings, true);
  assert.equal(capabilities.vision, true);
});

test('并发和后台任务沿用所属用户的三类模型，站点任务不继承个人 Key', async () => {
  const result = await Promise.all(
    [a.owner, b.owner, a.owner, b.owner].map((owner, index) =>
      withOwnerModel(db, owner, async () => {
        await new Promise((resolve) => setTimeout(resolve, (4 - index) * 4));
        return [
          currentChatService().model,
          currentEmbeddingService().model,
          currentVisionService().model,
          currentEmbeddingService().personal,
        ];
      }),
    ),
  );
  assert.deepEqual(result[0], ['', 'personal-embedding', 'personal-vision', true]);
  assert.deepEqual(result[1], ['', 'site-vector', 'site-vision', undefined]);
  assert.deepEqual(result[2], result[0]);
  assert.deepEqual(result[3], result[1]);
  assert.equal(currentEmbeddingService(), config.embedding);
  assert.equal(currentVisionService(), config.vision);
  // The actual adapters must select the personal service too, not quietly use the site credentials.
  for (const kind of ['embedding', 'vision'] as const)
    db.run(
      'UPDATE service_model_settings SET base=? WHERE owner=? AND kind=?',
      'https://127.0.0.1/v1',
      a.owner,
      kind,
    );
  await assert.rejects(() => withOwnerModel(db, a.owner, () => embeddings(['fixture'])), /无法连接/);
  await assert.rejects(
    () => withOwnerModel(db, a.owner, () => describePage(Buffer.from('fixture'))),
    /无法连接/,
  );
});

test('切换向量模型只失效本人的旧向量，课件原文与他人索引保留，恢复默认同样生效', async () => {
  for (const client of [a, b]) {
    const owner = client.owner;
    db.run(
      "INSERT INTO courses VALUES(?,?,?,'bean','sage',NULL,0,0,'now')",
      `course-${owner}`,
      owner,
      'fixture',
    );
    db.run(
      "INSERT INTO documents(id,owner,course_id,name,mime,filename,hash,status,created_at) VALUES(?,?,?,'fixture.txt','text/plain','fixture','fixture','ready','now')",
      `doc-${owner}`,
      owner,
      `course-${owner}`,
    );
    db.run(
      'INSERT INTO chunks VALUES(?,?,?,?,?,?)',
      `chunk-${owner}`,
      `doc-${owner}`,
      `course-${owner}`,
      1,
      '课件原文',
      '[1,0,0]',
    );
  }
  const saved = await a.call('/model-settings/embedding', 'PUT', { mode: 'site' });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.indexReset, 1);
  assert.equal(
    db.get<{ embedding: string | null }>('SELECT embedding FROM chunks WHERE id=?', `chunk-${a.owner}`)!
      .embedding,
    null,
  );
  assert.equal(
    db.get<{ text: string }>('SELECT text FROM chunks WHERE id=?', `chunk-${a.owner}`)!.text,
    '课件原文',
  );
  assert.equal(
    db.get<{ embedding: string }>('SELECT embedding FROM chunks WHERE id=?', `chunk-${b.owner}`)!.embedding,
    '[1,0,0]',
  );
  assert.equal((await a.call('/model-settings/embedding', 'PUT', { mode: 'site' })).body.indexReset, 0);
  for (const kind of ['embedding', 'vision']) {
    const cleared = await a.call(`/model-settings/${kind}`, 'DELETE');
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.hasKey, false);
    assert.equal(cleared.body.mode, 'site');
  }
});
