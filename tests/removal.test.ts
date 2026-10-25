import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../server/db.ts';
import { createApp } from '../server/app.ts';
import { config } from '../server/config.ts';
import { linkLegacyStuckNotes } from '../server/domain.ts';

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyu-removal-'));
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
const now = () => new Date().toISOString();
const count = (sql: string, ...args: string[]) => Number(db.get<{ n: number }>(sql, ...args)!.n);

function seedDocument(owner: string, courseId: string, status = 'ready') {
  const documentId = randomUUID(),
    pointId = randomUUID(),
    quizId = randomUUID(),
    filename = `file-${documentId}`;
  fs.mkdirSync(path.join(testDir, 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(testDir, 'uploads', filename), 'x');
  fs.mkdirSync(path.join(testDir, 'pages', documentId), { recursive: true });
  db.run(
    'INSERT INTO documents(id,owner,course_id,name,mime,filename,hash,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    documentId, owner, courseId, '讲义.txt', 'text/plain', filename, documentId, status, now(),
  );
  db.run("INSERT INTO pages(document_id,number,text,method) VALUES(?,1,'正文','native')", documentId);
  const chunkId = randomUUID();
  db.run('INSERT INTO chunks(id,document_id,course_id,page,text) VALUES(?,?,?,1,?)', chunkId, documentId, courseId, '正文');
  db.run(
    "INSERT INTO points(id,course_id,document_id,title,group_index,source_ids,state) VALUES(?,?,?,'知识点',0,?,'developing')",
    pointId, courseId, documentId, JSON.stringify([chunkId]),
  );
  db.run(
    "INSERT INTO quizzes(id,course_id,point_id,prompt,options,correct_option_id,explanation,source_ids,mode,created_at) VALUES(?,?,?,'题','[]','a','解','[]','model',?)",
    quizId, courseId, pointId, now(),
  );
  db.run(
    "INSERT INTO attempts(id,quiz_id,owner,option_id,correct,hinted,result,created_at) VALUES(?,?,?,'a',1,0,'{}',?)",
    randomUUID(), quizId, owner, now(),
  );
  db.run(
    "INSERT INTO stuck(id,course_id,point_id,document_id,page,text,created_at) VALUES(?,?,?,?,1,'不懂',?)",
    randomUUID(), courseId, pointId, documentId, now(),
  );
  db.run(
    "INSERT INTO highlights(id,owner,document_id,page,start_offset,end_offset,text,created_at) VALUES(?,?,?,1,0,2,'正文',?)",
    randomUUID(), owner, documentId, now(),
  );
  db.run(
    "INSERT INTO messages(id,course_id,document_id,role,text,created_at) VALUES(?,?,?,'user','问',?)",
    randomUUID(), courseId, documentId, now(),
  );
  return documentId;
}

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  await a.call('/bootstrap');
  await b.call('/bootstrap');
});
after(() => {
  server.close();
  db.close?.();
});

test('课程可指定空地，占用的地块返回 409', async () => {
  const made = await a.call('/courses', { name: '线性代数', shape: 'bean', palette: 'sky', requestId: randomUUID(), seaId: 0, slotId: 4 });
  assert.equal(made.status, 201);
  assert.equal(made.body.slotId, 4);
  const taken = await a.call('/courses', { name: '另一门', shape: 'bean', palette: 'sky', requestId: randomUUID(), seaId: 0, slotId: 4 });
  assert.equal(taken.status, 409);
  const half = await a.call('/courses', { name: '缺字段', shape: 'bean', palette: 'sky', requestId: randomUUID(), seaId: 0 });
  assert.equal(half.status, 422);
});

test('删除资料会清掉派生数据和文件，保留卡点与对话', async () => {
  const course = await a.call('/courses', { name: '概率论', shape: 'bean', palette: 'apricot', requestId: randomUUID() });
  const owner = a.cookie.split('=')[1];
  const documentId = seedDocument(owner, course.body.id);
  assert.equal((await b.call(`/documents/${documentId}`, undefined, 'DELETE')).status, 404);
  const removed = await a.call(`/documents/${documentId}`, undefined, 'DELETE');
  assert.equal(removed.status, 200);
  for (const table of ['pages', 'chunks', 'points', 'highlights'])
    assert.equal(count(`SELECT COUNT(*) n FROM ${table} WHERE document_id=?`, documentId), 0, table);
  assert.equal(count('SELECT COUNT(*) n FROM quizzes WHERE course_id=?', course.body.id), 0);
  assert.equal(count('SELECT COUNT(*) n FROM stuck WHERE course_id=? AND document_id IS NULL', course.body.id), 1);
  assert.equal(count('SELECT COUNT(*) n FROM messages WHERE course_id=? AND document_id IS NULL', course.body.id), 1);
  assert.equal(fs.existsSync(path.join(testDir, 'pages', documentId)), false);
  assert.equal(fs.existsSync(path.join(testDir, 'uploads', `file-${documentId}`)), false);
});

test('处理中的资料不能删除；删除课程会释放地块', async () => {
  const course = await a.call('/courses', { name: '数据结构', shape: 'bean', palette: 'sage', requestId: randomUUID() });
  const owner = a.cookie.split('=')[1];
  const busy = seedDocument(owner, course.body.id, 'parsing');
  assert.equal((await a.call(`/documents/${busy}`, undefined, 'DELETE')).status, 409);
  assert.equal((await a.call(`/courses/${course.body.id}`, undefined, 'DELETE')).status, 409);
  db.run("UPDATE documents SET status='ready' WHERE id=?", busy);
  assert.equal((await b.call(`/courses/${course.body.id}`, undefined, 'DELETE')).status, 404);
  assert.equal((await a.call(`/courses/${course.body.id}`, undefined, 'DELETE')).status, 200);
  assert.equal(count('SELECT COUNT(*) n FROM courses WHERE id=?', course.body.id), 0);
  assert.equal(count('SELECT COUNT(*) n FROM documents WHERE course_id=?', course.body.id), 0);
  const list = await a.call('/courses');
  assert.equal(list.body.some((item: { id: string }) => item.id === course.body.id), false);
  const again = await a.call('/courses', {
    name: '新课', shape: 'bean', palette: 'sage', requestId: randomUUID(),
    seaId: course.body.seaId, slotId: course.body.slotId,
  });
  assert.equal(again.status, 201);
});

test('划线与已有划线重叠时合并；选中其中几个字可取消整段', async () => {
  const course = await a.call('/courses', { name: '离散数学', shape: 'bean', palette: 'lilac', requestId: randomUUID() });
  const owner = a.cookie.split('=')[1];
  const documentId = seedDocument(owner, course.body.id);
  db.run("UPDATE pages SET text='有限集合的元素个数可以计数，无限集合不行。' WHERE document_id=?", documentId);
  const text = '有限集合的元素个数可以计数，无限集合不行。';
  const mark = (start: number, end: number) =>
    a.call(`/documents/${documentId}/highlights`, { documentId, page: 1, start, end, text: text.slice(start, end) });
  await mark(0, 6);
  const merged = await mark(4, 10);
  assert.equal(merged.status, 201);
  assert.deepEqual([merged.body.start, merged.body.end, merged.body.text], [0, 10, text.slice(0, 10)]);
  await mark(14, 18);
  assert.equal((await a.call(`/documents/${documentId}/highlights`)).body.length, 2);
  // a few characters inside the first mark remove the whole mark, but not the other one
  const removed = await a.call(`/documents/${documentId}/highlights?page=1&start=2&end=4`, undefined, 'DELETE');
  assert.equal(removed.body.removed, 1);
  const rest = (await a.call(`/documents/${documentId}/highlights`)).body;
  assert.deepEqual(rest.map((item: { start: number }) => item.start), [14]);
  assert.equal((await b.call(`/documents/${documentId}/highlights?page=1&start=14&end=15`, undefined, 'DELETE')).status, 404);
});

test('知识点可标为不熟并出现在课程详情，非法值被拒绝', async () => {
  const course = await a.call('/courses', { name: '图论', shape: 'bean', palette: 'sky', requestId: randomUUID() });
  const owner = a.cookie.split('=')[1];
  seedDocument(owner, course.body.id);
  const detail = await a.call(`/courses/${course.body.id}/detail`);
  const point = detail.body.points[0];
  assert.equal(point.unfamiliar, false);
  assert.equal((await a.call(`/points/${point.id}`, { unfamiliar: 'yes' }, 'PATCH')).status, 422);
  assert.equal((await b.call(`/points/${point.id}`, { unfamiliar: true }, 'PATCH')).status, 404);
  assert.equal((await a.call(`/points/${point.id}`, { unfamiliar: true }, 'PATCH')).status, 200);
  const after = await a.call(`/courses/${course.body.id}/detail`);
  assert.equal(after.body.points[0].unfamiliar, true);
  assert.equal(after.body.points[0].title, point.title);
});

test('卡点和“这里不懂”自动关联到所在页的知识点，并进入知识图谱', async () => {
  const course = await a.call('/courses', { name: '操作系统', shape: 'bean', palette: 'sage', requestId: randomUUID() });
  const owner = a.cookie.split('=')[1];
  const documentId = seedDocument(owner, course.body.id);
  const point = (await a.call(`/courses/${course.body.id}/detail`)).body.points[0];
  db.run('UPDATE points SET unfamiliar=0 WHERE id=?', point.id);
  // written while reading page 1, no point chosen
  const fromReader = await a.call(`/courses/${course.body.id}/stuck`, { text: '这里为什么要加锁？', documentId, page: 1 });
  assert.equal(fromReader.status, 201);
  assert.equal(fromReader.body.pointId, point.id);
  // written in the course sheet without any context stays unlinked
  const loose = await a.call(`/courses/${course.body.id}/stuck`, { text: '整体还没串起来' });
  assert.equal(loose.body.pointId, null);
  const detail = (await a.call(`/courses/${course.body.id}/detail`)).body;
  assert.equal(detail.points.find((item: { id: string }) => item.id === point.id).unfamiliar, true);

  // notes saved before this change are linked once at startup
  db.run('UPDATE stuck SET point_id=NULL WHERE id=?', fromReader.body.id);
  db.run('UPDATE points SET unfamiliar=0 WHERE id=?', point.id);
  db.run("DELETE FROM schema_migrations WHERE name='stuck-graph'");
  linkLegacyStuckNotes(db);
  assert.equal(db.get<{ point_id: string }>('SELECT point_id FROM stuck WHERE id=?', fromReader.body.id)!.point_id, point.id);
  assert.equal(db.get<{ unfamiliar: number }>('SELECT unfamiliar FROM points WHERE id=?', point.id)!.unfamiliar, 1);
});

test('开场引导按匿名身份只出现一次：新 cookie 重新出现，其他用户不受影响', async () => {
  const fresh = client();
  assert.equal((await fresh.call('/bootstrap')).body.profile.introSeen, false);
  assert.equal((await fresh.call('/profile', { introSeen: true }, 'PATCH')).status, 200);
  assert.equal((await fresh.call('/bootstrap')).body.profile.introSeen, true);
  assert.equal((await fresh.call('/profile', { introSeen: 'yes' }, 'PATCH')).status, 422);
  // a cleared cookie is a new anonymous profile, so the intro shows again
  const cleared = client();
  assert.equal((await cleared.call('/bootstrap')).body.profile.introSeen, false);
});

test('点击音效独立保存、校验并隔离；旧资料补齐默认值后修改设置不丢失偏好', async () => {
  const fresh = client();
  assert.equal((await fresh.call('/bootstrap')).body.profile.clickSound, true);
  assert.equal((await fresh.call('/profile', { clickSound: false }, 'PATCH')).body.clickSound, false);
  assert.equal((await fresh.call('/profile', { dailyMinutes: 20 }, 'PATCH')).body.clickSound, false);
  assert.equal((await fresh.call('/bootstrap')).body.profile.clickSound, false);
  assert.equal((await fresh.call('/profile', { clickSound: 'yes' }, 'PATCH')).status, 422);
  const other = client();
  assert.equal((await other.call('/bootstrap')).body.profile.clickSound, true);
  const owner = other.cookie.split('=')[1];
  db.run('UPDATE profiles SET settings=? WHERE id=?', JSON.stringify({ timezone: 'Asia/Singapore', dailyMinutes: 15, seaSound: false, reducedMotion: false }), owner);
  const migrated = await other.call('/profile', { dailyMinutes: 30 }, 'PATCH');
  assert.equal(migrated.body.clickSound, true);
  assert.equal(migrated.body.seaSound, false);
  assert.equal((await other.call('/bootstrap')).body.profile.clickSound, true);
});
