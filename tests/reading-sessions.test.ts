import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../server/db.ts';
import { createApp } from '../server/app.ts';
import { config } from '../server/config.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyu-reading-sessions-'));
config.dataDir = dir;
config.publicOrigin = '';
config.tavilyKey = '';
config.embedding = { base: '', key: '', model: '' };
config.vision = { base: '', key: '', model: '' };
const filename = path.join(dir, 'test.sqlite'),
  db = openDatabase(filename);
const { app } = createApp(db, { processDocuments: false, party: false });
const server = http.createServer(app);
let base = '',
  history: { role: string; text: string }[] = [];
const model = http.createServer(async (req, res) => {
  const parts: Buffer[] = [];
  for await (const part of req) parts.push(Buffer.from(part));
  const input = JSON.parse(JSON.parse(Buffer.concat(parts).toString()).messages[1].content);
  history = input.history;
  res.setHeader('Content-Type', 'application/json');
  res.end(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              schemaVersion: 1,
              insufficientEvidence: false,
              sections: [
                {
                  text: '数组通过下标访问。',
                  basis: 'course_material',
                  sourceChunkIds: [input.sources[0].id],
                  externalSources: [],
                },
              ],
            }),
          },
        },
      ],
    }),
  );
});
function client() {
  let cookie = '';
  return {
    get owner() {
      return cookie.split('=')[1];
    },
    async call(route: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
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
  b = client(),
  course = randomUUID(),
  doc = randomUUID(),
  chunk = randomUUID();
const oldUser = randomUUID(),
  oldAssistant = randomUUID(),
  image = randomUUID();
let savedSession = '';
before(async () => {
  await Promise.all([
    new Promise<void>((r) => server.listen(0, '127.0.0.1', r)),
    new Promise<void>((r) => model.listen(0, '127.0.0.1', r)),
  ]);
  base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  config.llm = {
    base: `http://127.0.0.1:${(model.address() as import('node:net').AddressInfo).port}/v1`,
    key: '',
    model: 'fixture',
  };
  await Promise.all([a.call('/bootstrap'), b.call('/bootstrap')]);
  db.run("INSERT INTO courses VALUES(?,?,?,'bean','sage',NULL,0,0,'now')", course, a.owner, 'Java');
  db.run(
    "INSERT INTO documents(id,owner,course_id,name,mime,filename,hash,status,created_at) VALUES(?,?,?,'数组.txt','text/plain','fixture','fixture','ready','now')",
    doc,
    a.owner,
    course,
  );
  db.run(
    'INSERT INTO chunks(id,document_id,course_id,page,text) VALUES(?,?,?,?,?)',
    chunk,
    doc,
    course,
    1,
    '数组通过下标访问元素。',
  );
  db.run(
    "INSERT INTO messages(id,course_id,document_id,role,text,created_at) VALUES(?,?,?,'user','以前的数组问题','now')",
    oldUser,
    course,
    doc,
  );
  db.run(
    "INSERT INTO messages(id,course_id,document_id,role,text,sections,sources,created_at) VALUES(?,?,?,'assistant','旧答案',?,?,'now')",
    oldAssistant,
    course,
    doc,
    JSON.stringify([
      { text: '旧答案', basis: 'course_material', sourceChunkIds: [chunk], externalSources: [] },
    ]),
    JSON.stringify([
      { id: chunk, documentId: doc, documentName: '数组.txt', page: 1, text: '数组通过下标访问元素。' },
    ]),
  );
  fs.mkdirSync(path.join(dir, 'chat-images'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'chat-images', 'saved.png'), 'fixture');
  db.run(
    'INSERT INTO chat_images VALUES(?,?,?,?,?,?)',
    image,
    oldUser,
    a.owner,
    course,
    'saved.png',
    '习题.png',
  );
  db.run(
    'INSERT INTO message_tools VALUES(?,?)',
    oldAssistant,
    JSON.stringify([
      {
        id: 'web',
        status: 'done',
        label: '已调用 Tavily 联网搜索',
        pages: [{ title: 'Java', url: 'https://docs.oracle.com/en/java/' }],
      },
    ]),
  );
});
after(async () => {
  await Promise.all([
    new Promise<void>((r) => server.close(() => r())),
    new Promise<void>((r) => model.close(() => r())),
  ]);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('保存会话保留完整图片、引用和工具记录，清空当前窗口并计一次热力图', async () => {
  assert.equal((await a.call(`/courses/${course}/messages`)).body.length, 2);
  const saved = await a.call(`/courses/${course}/reading-sessions`, {
    action: 'save',
    lastMessageId: oldAssistant,
  });
  assert.equal(saved.status, 200);
  savedSession = saved.body.sessionId;
  assert.deepEqual((await a.call(`/courses/${course}/messages`)).body, []);
  const list = (await a.call(`/courses/${course}/reading-sessions`)).body;
  assert.equal(list.length, 1);
  assert.equal(list[0].title, '以前的数组问题');
  assert.equal(list[0].messageCount, 2);
  const restored = (await a.call(`/courses/${course}/reading-sessions/${savedSession}`)).body;
  assert.equal(restored[0].images[0].url, `/api/chat-images/${image}`);
  assert.equal(restored[1].sources[0].id, chunk);
  assert.match(restored[1].tools[0].label, /已调用 Tavily/);
  assert.equal(fs.existsSync(path.join(dir, 'chat-images', 'saved.png')), true);
  assert.equal(
    (await a.call(`/courses/${course}/reading-sessions`, { action: 'save', lastMessageId: oldAssistant }))
      .status,
    409,
  );
  assert.equal(db.get<{ n: number }>("SELECT COUNT(*) n FROM events WHERE type='reading'")!.n, 1);
  assert.equal((await b.call(`/courses/${course}/reading-sessions`)).status, 404);
  assert.equal((await b.call(`/courses/${course}/reading-sessions/${savedSession}`)).status, 404);
});
test('新会话不携带已归档上下文，当前对话继续保留；重新打开数据库仍能恢复历史', async () => {
  const result = await a.call(`/courses/${course}/ask`, { question: '数组新问题' });
  assert.equal(result.status, 200);
  assert.equal(history.length, 0);
  assert.equal((await a.call(`/courses/${course}/messages`)).body.length, 2);
  await a.call(`/courses/${course}/ask`, { question: '继续问数组' });
  assert.equal(history.length, 2);
  assert.equal(history[0].text, '数组新问题');
  assert.ok(history.every((item) => !item.text.includes('以前的')));
  const reopened = openDatabase(filename);
  try {
    assert.equal(reopened.get<{ n: number }>('SELECT COUNT(*) n FROM reading_sessions')!.n, 1);
    assert.equal(
      reopened.get<{ n: number }>('SELECT COUNT(*) n FROM messages WHERE session_id=?', savedSession)!.n,
      2,
    );
  } finally {
    reopened.close();
  }
});
test('不保留只删除当前消息、图片与工具，不误删历史，不增加热力图', async () => {
  const current = (await a.call(`/courses/${course}/messages`)).body;
  const transientUser = current[0].id,
    transientAssistant = current.at(-1).id;
  fs.writeFileSync(path.join(dir, 'chat-images', 'discard.png'), 'fixture');
  db.run(
    'INSERT INTO chat_images VALUES(?,?,?,?,?,?)',
    randomUUID(),
    transientUser,
    a.owner,
    course,
    'discard.png',
    '临时.png',
  );
  assert.equal(
    (await a.call(`/courses/${course}/reading-sessions`, { action: 'discard', lastMessageId: 'stale-id' }))
      .status,
    409,
  );
  assert.equal((await a.call(`/courses/${course}/messages`)).body.length, current.length);
  assert.equal(
    (
      await a.call(`/courses/${course}/reading-sessions`, {
        action: 'discard',
        lastMessageId: transientAssistant,
      })
    ).status,
    200,
  );
  assert.deepEqual((await a.call(`/courses/${course}/messages`)).body, []);
  assert.equal(fs.existsSync(path.join(dir, 'chat-images', 'discard.png')), false);
  assert.equal(fs.existsSync(path.join(dir, 'chat-images', 'saved.png')), true);
  assert.equal(
    db.get('SELECT message_id FROM message_tools WHERE message_id=?', transientAssistant),
    undefined,
  );
  assert.equal((await a.call(`/courses/${course}/reading-sessions/${savedSession}`)).body.length, 2);
  assert.equal(db.get<{ n: number }>("SELECT COUNT(*) n FROM events WHERE type='reading'")!.n, 1);
});
test('跨课程访问历史被拒绝，删除课程清理归档和附件，同时保留热力图事件', async () => {
  const other = randomUUID();
  db.run("INSERT INTO courses VALUES(?,?,?,'bean','sage',NULL,0,1,'now')", other, a.owner, '另一门课');
  assert.equal((await a.call(`/courses/${other}/reading-sessions/${savedSession}`)).status, 404);
  assert.equal((await a.call(`/courses/${course}`, undefined, 'DELETE')).status, 200);
  assert.equal(db.get<{ n: number }>('SELECT COUNT(*) n FROM reading_sessions')!.n, 0);
  assert.equal(fs.existsSync(path.join(dir, 'chat-images', 'saved.png')), false);
  assert.equal(db.get<{ n: number }>("SELECT COUNT(*) n FROM events WHERE type='reading'")!.n, 1);
});
