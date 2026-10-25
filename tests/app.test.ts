import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../server/db.ts';
import { createApp } from '../server/app.ts';
import { assertSourceIds } from '../server/domain.ts';
import { config } from '../server/config.ts';
import { answerQuestion } from '../server/services/learning.ts';

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyu-api-'));
config.dataDir = testDir;
const db = openDatabase(path.join(testDir, 'test.sqlite'));
const { app } = createApp(db, { processDocuments: false, party: false });
const server = http.createServer(app);
let base = '';
function client() {
  let cookie = '';
  return {
    get cookie() {
      return cookie;
    },
    async call(route: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
      const response = await fetch(`${base}/api${route}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const next = response.headers.get('set-cookie');
      if (next) cookie = next.split(';')[0];
      return { status: response.status, body: await response.json() };
    },
  };
}
const a = client(),
  b = client();
let courseId = '',
  otherCourse = '',
  pointId = '',
  chunkId = '',
  documentId = '';
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  await a.call('/bootstrap');
  await b.call('/bootstrap');
  const created = await a.call('/courses', {
    name: '概率论',
    shape: 'bean',
    palette: 'apricot',
    requestId: randomUUID(),
  });
  courseId = created.body.id;
  const second = await b.call('/courses', {
    name: '他人的课程',
    shape: 'polygon',
    palette: 'sage',
    requestId: randomUUID(),
  });
  otherCourse = second.body.id;
  const owner = a.cookie.split('=')[1];
  documentId = randomUUID();
  chunkId = randomUUID();
  pointId = randomUUID();
  db.run(
    'INSERT INTO documents(id,owner,course_id,name,mime,filename,hash,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    documentId,
    owner,
    courseId,
    '概率论课件.txt',
    'text/plain',
    'fixture',
    'fixture',
    'ready',
    new Date().toISOString(),
  );
  const content =
    '条件概率是已知事件 B 发生的条件下事件 A 发生的概率。独立事件表示一个事件发生不影响另一个事件发生的概率。样本空间包含随机试验中全部可能的结果。随机变量描述试验结果对应的数值。';
  db.run(
    'INSERT INTO chunks(id,document_id,course_id,page,text) VALUES(?,?,?,?,?)',
    chunkId,
    documentId,
    courseId,
    1,
    content,
  );
  db.run(
    'INSERT INTO pages(document_id,number,text,method) VALUES(?,?,?,?)',
    documentId,
    1,
    content,
    'native',
  );
  db.run('UPDATE documents SET page_count=1 WHERE id=?', documentId);
  db.run(
    'INSERT INTO points(id,course_id,document_id,title,group_index,source_ids) VALUES(?,?,?,?,?,?)',
    pointId,
    courseId,
    documentId,
    '条件概率与独立事件',
    0,
    JSON.stringify([chunkId]),
  );
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
  fs.rmSync(testDir, { recursive: true, force: true });
});

test('课程创建幂等，固定槽位与会话隔离', async () => {
  const request = { name: '英语', shape: 'crescent', palette: 'lilac', requestId: randomUUID() };
  const one = await a.call('/courses', request),
    again = await a.call('/courses', request);
  assert.equal(one.status, 201);
  assert.equal(one.body.id, again.body.id);
  assert.equal(one.body.slotId, 1);
  const own = await a.call('/courses');
  assert.equal(own.body.length, 2);
  assert.equal((await b.call(`/courses/${courseId}/detail`)).status, 404);
  assert.equal((await a.call(`/courses/${otherCourse}/detail`)).status, 404);
  assert.equal((await a.call('/courses', { ...request, requestId: randomUUID(), name: 123 })).status, 422);
});

test('每海域六岛，第七岛进入新海域；已有槽位和重放结果保持正确', async () => {
  const c = client();
  await c.call('/bootstrap');
  const created: { id: string; seaId: number; slotId: number }[] = [];
  const requests = [];
  for (let index = 0; index < 7; index++) {
    const request = { name: `课程 ${index + 1}`, shape: 'bean', palette: 'sage', requestId: randomUUID() };
    requests.push(request);
    const response = await c.call('/courses', request);
    assert.equal(response.status, 201);
    created.push(response.body);
    assert.equal(response.body.seaId, Math.floor(index / 6));
    assert.equal(response.body.slotId, index % 6);
    const all = await c.call('/courses');
    for (const existing of created) {
      const saved = all.body.find((course: { id: string }) => course.id === existing.id);
      assert.equal(saved.seaId, existing.seaId);
      assert.equal(saved.slotId, existing.slotId);
    }
  }
  assert.equal(created.filter((item) => item.seaId === 0).length, 6);
  // Cached replies from an earlier layout must not restore an outdated coordinate.
  db.run(
    'UPDATE idempotency SET response=? WHERE owner=? AND request_id=?',
    JSON.stringify({ ...created[6], seaId: 9, slotId: 2 }),
    c.cookie.split('=')[1],
    requests[6].requestId,
  );
  const replay = await c.call('/courses', requests[6]);
  assert.equal(replay.body.id, created[6].id);
  assert.equal(replay.body.seaId, 1);
  assert.equal(replay.body.slotId, 0);
  assert.equal((await c.call('/courses')).body.length, 7);
});
test('原文检索保留真实来源；没有证据时明确提示', async () => {
  const answer = await a.call(`/courses/${courseId}/ask`, {
    question: '条件概率是什么？',
    documentId,
    page: 1,
  });
  assert.equal(answer.status, 200);
  assert.equal(answer.body.mode, 'extractive');
  assert.equal(answer.body.sources[0].id, chunkId);
  assert.equal(answer.body.sources[0].page, 1);
  assert.equal(answer.body.sections[0].basis, 'course_material');
  const outside = await a.call(`/courses/${courseId}/ask`, { question: '火星地幔同位素地质年代' });
  assert.equal(outside.body.sources.length, 0);
  assert.equal(outside.body.insufficientEvidence, true);
  assert.match(outside.body.text, /未检索到/);
});
test('跨课程来源和卡点关联被拒绝', async () => {
  assert.throws(() => assertSourceIds(db, otherCourse, [chunkId]), /引用不属于/);
  assert.throws(() => assertSourceIds(db, courseId, [chunkId], new Set()), /引用不属于/);
  const denied = await b.call(`/courses/${otherCourse}/stuck`, { text: '关联另一人的资料', documentId });
  assert.equal(denied.status, 422);
  const invalidPage = await a.call(`/courses/${courseId}/stuck`, { text: '这里不懂', documentId, page: 2 });
  assert.equal(invalidPage.status, 422);
  const added = await a.call(`/courses/${courseId}/stuck`, {
    text: '独立和互斥有什么区别',
    pointId,
    documentId,
    page: 1,
  });
  assert.equal(added.status, 201);
});
test('答案只在提交后返回，重复提交不重复成长和记活动', async () => {
  const generated = await a.call(`/courses/${courseId}/quiz`, { pointId });
  assert.equal(generated.status, 200);
  assert.equal(generated.body.mode, 'source_cloze');
  assert.equal(generated.body.correctOptionId, undefined);
  assert.equal(generated.body.explanation, undefined);
  const stored = db.get<{ correct_option_id: string }>(
    'SELECT correct_option_id FROM quizzes WHERE id=?',
    generated.body.id,
  )!;
  const submitted = await a.call(`/quizzes/${generated.body.id}/submit`, {
    optionId: stored.correct_option_id,
    hinted: false,
    requestId: randomUUID(),
  });
  assert.equal(submitted.body.correct, true);
  assert.equal(submitted.body.after, 'developing');
  const duplicate = await a.call(`/quizzes/${generated.body.id}/submit`, {
    optionId: stored.correct_option_id,
    hinted: false,
    requestId: randomUUID(),
  });
  assert.deepEqual(duplicate.body, submitted.body);
  assert.equal(
    db.get<{ count: number }>("SELECT COUNT(*) AS count FROM events WHERE type='review'")!.count,
    1,
  );
  const second = await a.call(`/courses/${courseId}/quiz`, { pointId });
  assert.notEqual(second.body.prompt, generated.body.prompt);
  const secondStored = db.get<{ correct_option_id: string }>(
    'SELECT correct_option_id FROM quizzes WHERE id=?',
    second.body.id,
  )!;
  const next = await a.call(`/quizzes/${second.body.id}/submit`, {
    optionId: secondStored.correct_option_id,
    hinted: false,
    requestId: randomUUID(),
  });
  assert.equal(next.body.after, 'mastered');
  assert.equal(
    (
      await b.call(`/quizzes/${second.body.id}/submit`, {
        optionId: 'A',
        hinted: false,
        requestId: randomUUID(),
      })
    ).status,
    404,
  );
});
test('共读完成按实际消息去重，记录与阅读位置持久化', async () => {
  await a.call(`/courses/${courseId}/reading-complete`, { sessionId: randomUUID() });
  await a.call(`/courses/${courseId}/reading-complete`, { sessionId: randomUUID() });
  assert.equal(
    db.get<{ count: number }>("SELECT COUNT(*) AS count FROM events WHERE type='reading'")!.count,
    1,
  );
  assert.equal((await a.call(`/documents/${documentId}/position`, { page: 1 }, 'PUT')).status, 200);
  assert.equal((await a.call(`/documents/${documentId}`)).body.position, 1);
  assert.equal((await b.call(`/documents/${documentId}`)).status, 404);
  const activity = await a.call('/activity');
  assert.equal(
    activity.body.reduce((sum: number, day: { count: number }) => sum + day.count, 0),
    3,
  );
  assert.equal((await a.call('/profile', { seaSound: 'true' }, 'PATCH')).status, 422);
  assert.equal((await a.call('/profile', { dailyMinutes: 1 }, 'PATCH')).status, 422);
  assert.equal((await a.call('/profile', { timezone: 'Invalid/Timezone' }, 'PATCH')).status, 422);
});
test('错误来源请求被拒绝', async () => {
  const response = await fetch(`${base}/api/courses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: a.cookie, Origin: 'https://unrelated.invalid' },
    body: '{}',
  });
  assert.equal(response.status, 403);
});
test('模型输出两次修复后通过；持续跨课程引用三次后失败且不写消息', async () => {
  const old = { ...config.llm };
  let calls = 0,
    mode: 'repair' | 'invalid' = 'repair';
  const fake = http.createServer(async (req, res) => {
    for await (const _ of req) {
      /* drain test-only request */
    }
    calls++;
    const valid = {
      schemaVersion: 1,
      insufficientEvidence: false,
      sections: [
        {
          text: '条件概率讨论已知某事件发生时的概率。',
          basis: 'course_material',
          sourceChunkIds: [mode === 'invalid' ? 'foreign-source' : chunkId],
          externalSources: [],
        },
      ],
    };
    const content =
      mode === 'repair' && calls < 3 ? JSON.stringify({ schemaVersion: 'bad' }) : JSON.stringify(valid);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
  config.llm.base = `http://127.0.0.1:${(fake.address() as import('node:net').AddressInfo).port}`;
  config.llm.model = 'test-fixture';
  try {
    const answer = await answerQuestion(db, courseId, '条件概率');
    assert.equal(answer.mode, 'model');
    assert.equal(calls, 3);
    const before = db.get<{ count: number }>('SELECT COUNT(*) AS count FROM messages')!.count;
    mode = 'invalid';
    calls = 0;
    await assert.rejects(() => answerQuestion(db, courseId, '条件概率'), /连续未通过校验/);
    assert.equal(calls, 3);
    assert.equal(db.get<{ count: number }>('SELECT COUNT(*) AS count FROM messages')!.count, before);
  } finally {
    Object.assign(config.llm, old);
    await new Promise<void>((resolve) => fake.close(() => resolve()));
  }
});

test('个人 API 加密保存、隔离空间、留空保留 Key，切换站点恢复原配置', async () => {
  const secret = 'sk-test-fixture-do-not-use';
  const saved = await a.call(
    '/model-settings',
    { mode: 'personal', base: 'https://api.example.com/v1', model: 'fixture', key: secret },
    'PUT',
  );
  assert.equal(saved.status, 200);
  assert.equal(saved.body.hasKey, true);
  assert.ok(!JSON.stringify(saved.body).includes(secret));
  const raw = db.get<{ secret: string }>(
    'SELECT secret FROM model_settings WHERE owner=?',
    a.cookie.split('=')[1],
  )!.secret;
  assert.ok(raw && !raw.includes(secret));
  assert.equal((await b.call('/model-settings')).body.hasKey, false);
  assert.equal(
    (
      await a.call(
        '/model-settings',
        { mode: 'personal', base: 'https://api.example.com/v1', model: 'next', key: '' },
        'PUT',
      )
    ).status,
    200,
  );
  assert.equal(
    db.get<{ secret: string }>('SELECT secret FROM model_settings WHERE owner=?', a.cookie.split('=')[1])!
      .secret,
    raw,
  );
  assert.equal(
    (
      await a.call(
        '/model-settings',
        { mode: 'personal', base: 'https://other.example.com/v1', model: 'next' },
        'PUT',
      )
    ).status,
    422,
  );
  assert.equal(
    (
      await a.call(
        '/model-settings',
        { mode: 'personal', base: 'https://127.0.0.1/v1', model: 'next', key: secret },
        'PUT',
      )
    ).status,
    422,
  );
  assert.equal((await a.call('/model-settings', { mode: 'site' }, 'PUT')).status, 200);
  assert.equal((await a.call('/model-settings', undefined, 'DELETE')).body.hasKey, false);
});

test('划线验证原文偏移、持久化去重、隔离空间；引用原句传给问答', async () => {
  const content = db.get<{ text: string }>('SELECT text FROM chunks WHERE id=?', chunkId)!.text;
  db.run(
    "INSERT OR REPLACE INTO pages(document_id,number,text,method) VALUES(?,1,?,'native')",
    documentId,
    content,
  );
  const quote = {
    documentId,
    page: 1,
    start: 0,
    end: content.indexOf('。') + 1,
    text: content.slice(0, content.indexOf('。') + 1),
  };
  const mark = await a.call(`/documents/${documentId}/highlights`, quote);
  assert.equal(mark.status, 201);
  assert.equal((await a.call(`/documents/${documentId}/highlights`, quote)).body.id, mark.body.id);
  assert.equal((await a.call(`/documents/${documentId}/highlights`)).body.length, 1);
  assert.equal((await b.call(`/documents/${documentId}/highlights`)).status, 404);
  assert.equal(
    (await a.call(`/documents/${documentId}/highlights`, { ...quote, text: '伪造的引用' })).status,
    422,
  );
  assert.equal(
    (
      await a.call(`/courses/${courseId}/ask`, {
        question: '解释这句',
        quote: { ...quote, text: '伪造的引用' },
      })
    ).status,
    422,
  );
  const answer = await a.call(`/courses/${courseId}/ask`, { question: '解释这句', quote });
  assert.equal(answer.status, 200);
  assert.ok(answer.body.sources.some((source: { id: string }) => source.id === chunkId));
  const user = db.get<{ text: string }>(
    "SELECT text FROM messages WHERE course_id=? AND role='user' ORDER BY rowid DESC LIMIT 1",
    courseId,
  )!;
  assert.ok(user.text.includes(quote.text));
  await a.call(`/documents/${documentId}/highlights/${mark.body.id}`, undefined, 'DELETE');
  assert.equal((await a.call(`/documents/${documentId}/highlights`)).body.length, 0);
});

test('个人 Key 无法解密时仍可进入页面、重新配置或清除，不阻断学习空间', async () => {
  db.run(
    "INSERT OR REPLACE INTO model_settings(owner,mode,base,model,secret) VALUES(?,'personal','https://api.example.com/v1','fixture','corrupted-record')",
    a.cookie.split('=')[1],
  );
  const bootstrap = await a.call('/bootstrap');
  assert.equal(bootstrap.status, 200);
  assert.equal(bootstrap.body.capabilities.chat, false);
  const settings = await a.call('/model-settings');
  assert.equal(settings.status, 200);
  assert.equal(settings.body.hasKey, false);
  assert.equal(settings.body.configured, false);
  const replaced = await a.call(
    '/model-settings',
    { mode: 'personal', base: 'https://api.example.com/v1', model: 'fixture', key: 'sk-new-test-fixture' },
    'PUT',
  );
  assert.equal(replaced.status, 200);
  assert.equal(replaced.body.hasKey, true);
  assert.equal((await a.call('/model-settings', undefined, 'DELETE')).status, 200);
});
