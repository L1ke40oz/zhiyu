import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.ts';
import { openDatabase } from '../server/db.ts';
import { config } from '../server/config.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyu-model-tools-'));
config.dataDir = dir;
config.publicOrigin = '';
config.embedding = { base: '', key: '', model: '' };
const db = openDatabase(path.join(dir, 'test.sqlite'));
const { app } = createApp(db, { processDocuments: false, party: false }),
  server = http.createServer(app);
let base = '',
  cookie = '',
  mode: 'auto' | 'plain' | 'unsupported' | 'foreign' | 'loop' = 'auto';
let searchCalls = 0,
  modelCalls = 0,
  searchStatus = 200,
  observedToolResult = false;
const course = randomUUID(),
  doc = randomUUID(),
  chunkId = randomUUID();
const upstream = http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString());
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/tavily') {
    searchCalls++;
    assert.equal(req.headers.authorization, 'Bearer fixture-tavily');
    res.statusCode = searchStatus;
    res.end(
      JSON.stringify({
        results: [
          { title: 'Java 官方文档', url: 'https://docs.oracle.com/en/java/', content: '数组外部资料。' },
        ],
      }),
    );
    return;
  }
  modelCalls++;
  if (mode === 'unsupported' && body.tools) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'tools not supported' }));
    return;
  }
  const toolMessage = body.messages.find((message: { role: string }) => message.role === 'tool');
  if (body.tools && mode !== 'plain' && (!toolMessage || mode === 'loop')) {
    assert.equal(body.tool_choice, 'auto');
    assert.equal(body.tools[0].function.name, 'tavily_search');
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: `call-${modelCalls}`,
                  type: 'function',
                  function: {
                    name: 'tavily_search',
                    arguments: JSON.stringify({ query: 'Java 数组 最新说明' }),
                  },
                },
              ],
            },
          },
        ],
      }),
    );
    return;
  }
  const input = JSON.parse(body.messages[1].content);
  const toolResult = toolMessage ? JSON.parse(toolMessage.content) : null;
  if (toolResult) {
    observedToolResult = true;
    assert.match(toolMessage.tool_call_id, /^call-/);
  }
  const sources = toolResult?.webSources || input.webSources || [];
  const web = sources[0];
  const value = {
    schemaVersion: 1,
    insufficientEvidence: false,
    sections: [
      {
        text: web ? '结合联网资料，数组使用下标访问。' : '课件说明数组使用下标访问。',
        basis: web ? 'web' : 'course_material',
        sourceChunkIds: web ? [] : [chunkId],
        externalSources: web
          ? [{ title: web.title, url: mode === 'foreign' ? 'https://invented.example.com/' : web.url }]
          : [],
      },
    ],
  };
  res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }));
});
async function call(route: string, body?: unknown) {
  const response = await fetch(`${base}/api${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  cookie = response.headers.get('set-cookie')?.split(';')[0] || cookie;
  return { status: response.status, body: await response.json() };
}
before(async () => {
  await Promise.all([
    new Promise<void>((r) => server.listen(0, '127.0.0.1', r)),
    new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r)),
  ]);
  base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  const address = `http://127.0.0.1:${(upstream.address() as import('node:net').AddressInfo).port}`;
  config.llm = { base: `${address}/v1`, key: 'fixture-model', model: 'fixture' };
  config.tavilyKey = 'fixture-tavily';
  config.tavilyUrl = `${address}/tavily`;
  await call('/bootstrap');
  const owner = cookie.split('=')[1];
  db.run("INSERT INTO courses VALUES(?,?,?,'bean','sage',NULL,0,0,'now')", course, owner, 'Java');
  db.run(
    "INSERT INTO documents(id,owner,course_id,name,mime,filename,hash,status,created_at) VALUES(?,?,?,'数组.txt','text/plain','fixture','fixture','ready','now')",
    doc,
    owner,
    course,
  );
  db.run(
    'INSERT INTO chunks(id,document_id,course_id,page,text) VALUES(?,?,?,?,?)',
    chunkId,
    doc,
    course,
    1,
    '数组通过下标访问元素，注意边界。',
  );
});
after(async () => {
  await Promise.all([
    new Promise<void>((r) => server.close(() => r())),
    new Promise<void>((r) => upstream.close(() => r())),
  ]);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('课件命中时模型仍可自主发起真实工具调用，结果回传模型且聊天保留工具名与来源', async () => {
  const result = await call(`/courses/${course}/ask`, { question: '数组的最新资料是什么？' });
  assert.equal(result.status, 200);
  assert.equal(searchCalls, 1);
  assert.equal(modelCalls, 2);
  assert.equal(observedToolResult, true);
  assert.equal(result.body.sections[0].basis, 'web');
  assert.equal(result.body.sections[0].externalSources[0].url, 'https://docs.oracle.com/en/java/');
  const tool = result.body.tools.find((item: { id: string }) => item.id === 'web');
  assert.match(tool.label, /已调用 Tavily 联网搜索/);
  assert.equal(tool.pages[0].title, 'Java 官方文档');
  const persisted = (await call(`/courses/${course}/messages`)).body.at(-1);
  assert.deepEqual(persisted.tools, result.body.tools);
});
test('普通课件问题由模型选择直接回答，不强制调用联网工具', async () => {
  mode = 'plain';
  const before = searchCalls;
  const result = await call(`/courses/${course}/ask`, { question: '数组如何访问元素？' });
  assert.equal(result.status, 200);
  assert.equal(searchCalls, before);
  assert.ok(!result.body.tools.some((tool: { id: string }) => tool.id === 'web'));
});
test('明确要求联网时即使课件命中、模型不支持工具也执行搜索', async () => {
  mode = 'unsupported';
  const before = searchCalls;
  const result = await call(`/courses/${course}/ask`, { question: '帮我联网搜索数组的资料' });
  assert.equal(result.status, 200);
  assert.equal(searchCalls, before + 1);
  assert.equal(result.body.sections[0].basis, 'web');
});
test('模型明确不支持工具时退回普通回答，提示用户可直接要求联网', async () => {
  mode = 'unsupported';
  const before = searchCalls;
  const result = await call(`/courses/${course}/ask`, { question: '解释数组' });
  assert.equal(result.status, 200);
  assert.equal(searchCalls, before);
  assert.match(
    result.body.tools.find((tool: { id: string }) => tool.id === 'web').label,
    /不支持自主工具调用/,
  );
});
test('工具返回失败时显示实际调用失败，不虚构网页，模型仍可使用课件作答', async () => {
  mode = 'auto';
  searchStatus = 401;
  try {
    const result = await call(`/courses/${course}/ask`, { question: '数组有哪些外部资料？' });
    assert.equal(result.status, 200);
    const web = result.body.tools.find((tool: { id: string }) => tool.id === 'web');
    assert.equal(web.status, 'error');
    assert.match(web.label, /已调用 Tavily.*401/);
    assert.equal(result.body.sections[0].basis, 'course_material');
    assert.deepEqual(result.body.sections[0].externalSources, []);
  } finally {
    searchStatus = 200;
  }
});
test('反复请求工具最多执行两轮，伪造网页引用校验失败且不保存消息', async () => {
  mode = 'loop';
  let before = searchCalls;
  const result = await call(`/courses/${course}/ask`, { question: '数组最新变化' });
  assert.equal(result.status, 200);
  assert.equal(searchCalls, before + 2);
  assert.match(result.body.tools.find((tool: { id: string }) => tool.id === 'web').label, /2 次/);
  mode = 'foreign';
  before = db.get<{ n: number }>('SELECT COUNT(*) n FROM messages')!.n;
  const invalid = await call(`/courses/${course}/ask`, { question: '数组最新变化' });
  assert.equal(invalid.status, 502);
  assert.equal(invalid.body.code, 'MODEL_VALIDATION_FAILED');
  assert.equal(db.get<{ n: number }>('SELECT COUNT(*) n FROM messages')!.n, before);
});
