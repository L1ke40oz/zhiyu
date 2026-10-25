import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createCanvas } from '@napi-rs/canvas';
import { openDatabase } from '../server/db.ts';
import { createApp } from '../server/app.ts';
import { config } from '../server/config.ts';

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyu-reader-tools-'));
config.dataDir = testDir;
config.publicOrigin = '';
config.llm = { base: '', key: '', model: '' };
config.embedding = { base: '', key: '', model: '' };
const db = openDatabase(path.join(testDir, 'reader.sqlite'));
const { app } = createApp(db, { processDocuments: false, party: false });
const server = http.createServer(app);
let base = '',
  courseId = '',
  documentId = '',
  secondDocument = '',
  foreignCourse = '';
let tavilyCalls = 0,
  tavilyDelay = 0,
  tavilyAuth = '',
  invalidWeb = false;
let invalidAnswer = false,
  modelCalls = 0,
  imageCalls = 0;
const model = http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString());
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/tavily') {
    tavilyCalls++;
    tavilyAuth = String(req.headers.authorization);
    if (tavilyDelay) await new Promise((resolve) => setTimeout(resolve, tavilyDelay));
    res.end(
      JSON.stringify({
        results: [
          {
            title: 'Java 官方说明',
            url: 'https://docs.oracle.com/en/java/',
            content: '联网资料片段，说明题目相关概念。',
          },
        ],
      }),
    );
    return;
  }
  if (req.url === '/v1/embeddings') {
    res.end(JSON.stringify({ data: [{ index: 0, embedding: [1, 0] }] }));
    return;
  }
  modelCalls++;
  assert.equal(body.model, 'fixture-vision');
  const content = body.messages[1].content;
  if (Array.isArray(content)) {
    assert.match(
      content.find((part: { type: string }) => part.type === 'image_url').image_url.url,
      /^data:image\/png;base64,/,
    );
    imageCalls++;
  }
  let answer = '图片题干：数组使用连续的存储空间，问如何访问数组中的元素。';
  if (body.response_format) {
    const input =
      typeof content === 'string'
        ? JSON.parse(content)
        : JSON.parse(content.find((part: { type: string }) => part.type === 'text').text);
    const source = input.sources[0];
    answer = JSON.stringify({
      schemaVersion: 1,
      insufficientEvidence: !source,
      sections: [
        {
          text: source
            ? '根据课件资料，使用下标访问数组元素，需检查边界。'
            : '当前资料依据不足，图片解答请核实。',
          basis: source ? 'course_material' : 'general',
          sourceChunkIds: source ? [invalidAnswer ? 'foreign-chunk' : source.id] : [],
          externalSources: [],
        },
      ],
    });
  }
  if (body.response_format) {
    const input =
      typeof content === 'string'
        ? JSON.parse(content)
        : JSON.parse(content.find((part: { type: string }) => part.type === 'text').text);
    if (input.webSources?.length)
      answer = JSON.stringify({
        schemaVersion: 1,
        insufficientEvidence: true,
        sections: [
          {
            text: '当前课件资料依据不足，以下联网补充请核实。',
            basis: 'general',
            sourceChunkIds: [],
            externalSources: [],
          },
          {
            text: '根据联网资料，可以这样理解。',
            basis: 'web',
            sourceChunkIds: [],
            externalSources: [
              {
                title: input.webSources[0].title,
                url: invalidWeb ? 'https://fabricated.example/' : input.webSources[0].url,
              },
            ],
          },
        ],
      });
  }
  res.end(JSON.stringify({ choices: [{ message: { content: answer } }] }));
});
function client() {
  let cookie = '';
  return {
    get cookie() {
      return cookie;
    },
    async call(route: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
      const multipart = body instanceof FormData;
      const response = await fetch(base + '/api' + route, {
        method,
        headers: {
          ...(multipart ? {} : { 'Content-Type': 'application/json' }),
          ...(cookie ? { Cookie: cookie } : {}),
        },
        ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }),
      });
      const next = response.headers.get('set-cookie');
      if (next) cookie = next.split(';')[0];
      return { status: response.status, body: await response.json() };
    },
    asset(route: string) {
      return fetch(base + route, { headers: cookie ? { Cookie: cookie } : {} });
    },
  };
}
const a = client(),
  b = client();
const canvas = createCanvas(200, 80);
const drawing = canvas.getContext('2d');
drawing.fillStyle = '#fff';
drawing.fillRect(0, 0, 200, 80);
drawing.fillStyle = '#000';
drawing.fillText('array[0] = ?', 15, 45);
const png = canvas.toBuffer('image/png');
function form(bytes = png, filename = 'exercise.png') {
  const data = new FormData();
  data.append('image', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), filename);
  data.append('question', '请解释这道数组题');
  return data;
}
before(async () => {
  await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve));
  config.vision = {
    base: `http://127.0.0.1:${(model.address() as import('node:net').AddressInfo).port}/v1`,
    key: 'fixture',
    model: 'fixture-vision',
  };
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  courseId = (
    await a.call('/courses', { name: '数组', shape: 'bean', palette: 'sage', requestId: randomUUID() })
  ).body.id;
  foreignCourse = (
    await b.call('/courses', { name: '其他人的课', shape: 'bean', palette: 'sage', requestId: randomUUID() })
  ).body.id;
  const owner = a.cookie.split('=')[1];
  for (const [index, content] of [
    '数组使用连续的存储空间，通过下标访问元素。',
    '数组在创建时需要初始化，必须遵循下标边界。',
  ].entries()) {
    const doc = randomUUID();
    if (!index) documentId = doc;
    else secondDocument = doc;
    db.run(
      'INSERT INTO documents(id,owner,course_id,name,mime,filename,hash,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
      doc,
      owner,
      courseId,
      `数组${index}.txt`,
      'text/plain',
      doc,
      doc,
      'ready',
      'now',
    );
    db.run('INSERT INTO pages(document_id,number,text,method) VALUES(?,1,?,?)', doc, content, 'native');
    db.run(
      'INSERT INTO chunks(id,document_id,course_id,page,text) VALUES(?,?,?,1,?)',
      randomUUID(),
      doc,
      courseId,
      content,
    );
  }
});
after(async () => {
  await Promise.all([
    new Promise<void>((resolve) => server.close(() => resolve())),
    new Promise<void>((resolve) => model.close(() => resolve())),
  ]);
  db.close();
  assert.ok(path.resolve(testDir).startsWith(path.resolve(os.tmpdir(), 'zhiyu-reader-tools-')));
  fs.rmSync(testDir, { recursive: true, force: true });
});

test('独立检索支持课程和单份课件范围，拒绝跨空间及空查询，不写入学习记录', async () => {
  const all = await a.call(`/courses/${courseId}/search?q=${encodeURIComponent('数组')}`);
  assert.equal(all.status, 200);
  assert.equal(all.body.sources.length, 2);
  assert.equal(all.body.mode, 'keyword');
  const scoped = await a.call(
    `/courses/${courseId}/search?q=${encodeURIComponent('数组')}&documentId=${documentId}`,
  );
  assert.deepEqual(
    scoped.body.sources.map((source: { documentId: string }) => source.documentId),
    [documentId],
  );
  assert.equal((await b.call(`/courses/${courseId}/search?q=array`)).status, 404);
  assert.equal((await a.call(`/courses/${courseId}/search?q=array&documentId=foreign`)).status, 422);
  assert.equal((await a.call(`/courses/${courseId}/search?q=`)).status, 422);
  assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM events')!.n, 0);
});
test('向量服务配置但资料无向量时如实显示关键词模式，有索引时使用语义检索', async () => {
  config.embedding = { ...config.vision, model: 'fixture-vector' };
  try {
    assert.equal(
      (await a.call(`/courses/${courseId}/search?q=${encodeURIComponent('数组')}`)).body.mode,
      'keyword',
    );
    db.run('UPDATE chunks SET embedding=? WHERE document_id=?', '[1,0]', documentId);
    const semantic = await a.call(`/courses/${courseId}/search?q=${encodeURIComponent('连续空间的结构')}`);
    assert.equal(semantic.body.mode, 'hybrid');
    assert.ok(
      semantic.body.sources.some((source: { documentId: string }) => source.documentId === documentId),
    );
  } finally {
    config.embedding = { base: '', key: '', model: '' };
    db.run('UPDATE chunks SET embedding=NULL');
  }
});
let savedImageUrl = '';
test('仅配置视觉模型即可看图、结合课件回答，图片随对话保存且仅当前用户可读取', async () => {
  const response = await a.call(`/courses/${courseId}/ask-image`, form());
  assert.equal(response.status, 200);
  assert.equal(response.body.mode, 'vision');
  assert.equal(imageCalls, 2);
  assert.equal(modelCalls, 2);
  assert.ok(response.body.sources.length);
  const messages = (await a.call(`/courses/${courseId}/messages`)).body;
  assert.equal(messages.length, 2);
  assert.equal(messages[0].images.length, 1);
  savedImageUrl = messages[0].images[0].url;
  const image = await a.asset(savedImageUrl);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.ok((await image.arrayBuffer()).byteLength > 0);
  assert.equal((await b.asset(savedImageUrl)).status, 404);
  assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM documents')!.n, 2);
  assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM events')!.n, 0);
});
test('拒绝伪图片、超过10MB、跨课程资料和未配置的视觉服务', async () => {
  const calls = modelCalls;
  assert.equal((await a.call(`/courses/${courseId}/ask-image`, form(Buffer.from('fake png')))).status, 422);
  assert.equal(
    (await a.call(`/courses/${courseId}/ask-image`, form(Buffer.alloc(10 * 1024 * 1024 + 1)))).status,
    413,
  );
  const bad = form();
  bad.append('documentId', 'foreign-document');
  assert.equal((await a.call(`/courses/${courseId}/ask-image`, bad)).status, 422);
  assert.equal((await a.call(`/courses/${foreignCourse}/ask-image`, form())).status, 404);
  const vision = config.vision;
  config.vision = { base: '', key: '', model: '' };
  try {
    assert.equal((await a.call(`/courses/${courseId}/ask-image`, form())).status, 503);
  } finally {
    config.vision = vision;
  }
  assert.equal(modelCalls, calls);
});
test('视觉回答不能伪造课件引用：有限重试后拒绝，失败不保存图片或消息', async () => {
  invalidAnswer = true;
  const before = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM messages')!.n;
  try {
    const response = await a.call(`/courses/${courseId}/ask-image`, form());
    assert.equal(response.status, 502);
    assert.equal(response.body.code, 'MODEL_VALIDATION_FAILED');
    assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM messages')!.n, before);
    assert.equal(fs.readdirSync(path.join(testDir, 'chat-images')).length, 1);
  } finally {
    invalidAnswer = false;
  }
});
test('Tavily 个人 Key 加密隔离，课件命中不联网，资料无命中时自动搜索并保留来源', async () => {
  config.tavilyUrl = config.vision.base.replace('/v1', '/tavily');
  config.tavilyKey = 'fixture-site';
  const personal = await a.call('/web-settings', { mode: 'personal', key: 'fixture-personal' }, 'PUT');
  assert.equal(personal.status, 200);
  assert.equal(personal.body.hasKey, true);
  assert.ok(!JSON.stringify(personal.body).includes('fixture-personal'));
  const encrypted = db.get<{ secret: string }>(
    'SELECT secret FROM web_settings WHERE owner=?',
    a.cookie.split('=')[1],
  )!.secret;
  assert.ok(!encrypted.includes('fixture-personal'));
  assert.equal((await b.call('/web-settings')).body.hasKey, false);
  const before = tavilyCalls;
  await a.call(`/courses/${courseId}/ask`, { question: '数组' });
  assert.equal(tavilyCalls, before);
  const answer = await a.call(`/courses/${courseId}/ask`, { question: '火星地幔同位素' });
  assert.equal(answer.status, 200);
  assert.equal(tavilyCalls, before + 1);
  assert.equal(tavilyAuth, 'Bearer fixture-personal');
  assert.equal(answer.body.sections[0].basis, 'web');
  assert.equal(answer.body.sections[0].externalSources[0].url, 'https://docs.oracle.com/en/java/');
  assert.ok(
    answer.body.tools.some(
      (tool: { id: string; status: string }) => tool.id === 'web' && tool.status === 'done',
    ),
  );
  const history = (await a.call(`/courses/${courseId}/messages`)).body;
  assert.ok(history.at(-1).tools.some((tool: { id: string }) => tool.id === 'web'));
  assert.equal((await a.call('/web-settings', undefined, 'DELETE')).body.mode, 'site');
});
test('联网工具进度可见且按用户隔离；模型引用只能来自真实搜索结果', async () => {
  config.llm = { ...config.vision };
  tavilyDelay = 150;
  const requestId = randomUUID();
  try {
    const pending = a.call(`/courses/${courseId}/ask`, { question: '火星地幔同位素', requestId });
    let observed = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const progress = await a.call(`/assistant-work/${requestId}`);
      if (
        progress.body.tools.some(
          (tool: { id: string; status: string }) => tool.id === 'web' && tool.status === 'running',
        )
      ) {
        observed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(observed, true);
    assert.equal((await b.call(`/assistant-work/${requestId}`)).status, 404);
    const answer = await pending;
    assert.equal(answer.status, 200);
    assert.equal(answer.body.sections[1].basis, 'web');
    assert.equal((await a.call(`/assistant-work/${requestId}`)).body.status, 'done');
    assert.equal(tavilyAuth, 'Bearer fixture-site');
    invalidWeb = true;
    tavilyDelay = 0;
    const fake = await a.call(`/courses/${courseId}/ask`, { question: '火星地幔同位素' });
    assert.equal(fake.status, 502);
    assert.equal(fake.body.code, 'MODEL_VALIDATION_FAILED');
  } finally {
    invalidWeb = false;
    tavilyDelay = 0;
    config.llm = { base: '', key: '', model: '' };
    config.tavilyKey = '';
  }
});
test('删除课程会清理该课程的问答图片与引用', async () => {
  assert.equal((await a.call(`/courses/${courseId}`, undefined, 'DELETE')).status, 200);
  assert.equal((await a.asset(savedImageUrl)).status, 404);
  assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM chat_images')!.n, 0);
  assert.equal(fs.readdirSync(path.join(testDir, 'chat-images')).length, 0);
});
