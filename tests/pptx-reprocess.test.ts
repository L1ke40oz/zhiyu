import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../server/db.ts';
import { config } from '../server/config.ts';
import { PPTX_MIME, createDocumentQueue, stopOCR } from '../server/services/documents.ts';
import { readSlides } from '../server/services/pptx.ts';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyu-pptx-'));
config.dataDir = tempDir;
fs.mkdirSync(path.join(tempDir, 'uploads'));
const db = openDatabase(path.join(tempDir, 'pptx.sqlite'));
const owner = 'pptx-owner',
  course = randomUUID();
db.run('INSERT INTO profiles VALUES(?,?,?)', owner, '{}', new Date().toISOString());
db.run(
  'INSERT INTO courses VALUES(?,?,?,?,?,?,?,?,?)',
  course,
  owner,
  '集合论',
  'bean',
  'sage',
  null,
  0,
  0,
  new Date().toISOString(),
);
const queue = createDocumentQueue(db);
after(async () => {
  await stopOCR();
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

/** Tiny ZIP writer (deflate) so the fixture is a real .pptx archive. */
function zip(files: Record<string, string>) {
  const locals: Buffer[] = [],
    centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.from(content),
      packed = zlib.deflateRawSync(raw),
      nameBytes = Buffer.from(name),
      crc = zlib.crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, packed);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
const shape = (...paragraphs: string[]) =>
  `<p:sp><p:txBody>${paragraphs.map((p) => `<a:p><a:r><a:t>${p}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp>`;
const slide = (body: string) =>
  `<?xml version="1.0"?><p:sld xmlns:a="a" xmlns:p="p" xmlns:r="r"><p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`;
const rels = (items: [string, string][]) =>
  `<Relationships>${items.map(([id, target]) => `<Relationship Id="${id}" Type="t" Target="${target}"/>`).join('')}</Relationships>`;
// slide2.xml is shown first: order must follow presentation.xml, not file names
const deck = zip({
  'ppt/presentation.xml':
    '<p:presentation><p:sldIdLst><p:sldId id="256" r:id="rId9"/><p:sldId id="257" r:id="rId8"/></p:sldIdLst></p:presentation>',
  'ppt/_rels/presentation.xml.rels': rels([
    ['rId8', 'slides/slide1.xml'],
    ['rId9', 'slides/slide2.xml'],
  ]),
  'ppt/slides/slide2.xml': slide(
    shape('第四章 有限集和无限集', '集合 A &amp; B 的元素个数记作 |A|，满足 |A| &lt; |B| 时称 A 更小。'),
  ),
  'ppt/slides/slide1.xml': slide(shape('容斥原理', '|A ∪ B| = |A| + |B| − |A ∩ B|，用于计算并集的元素个数。')),
  'ppt/slides/_rels/slide1.xml.rels': rels([['rId2', '../notesSlides/notesSlide1.xml']]),
  'ppt/notesSlides/notesSlide1.xml': slide(shape('讲解时先画韦恩图。') + shape('2')),
});

async function settle(id: string) {
  for (let i = 0; i < 300; i++) {
    const row = db.get<{ status: string }>('SELECT status FROM documents WHERE id=?', id)!;
    if (['ready', 'partial', 'failed'].includes(row.status)) return row.status;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('processing timed out');
}
async function ingest(bytes: Buffer, mime: string, name: string) {
  const id = randomUUID();
  fs.writeFileSync(path.join(tempDir, 'uploads', id), bytes);
  db.run(
    'INSERT INTO documents(id,owner,course_id,name,mime,filename,hash,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    id,
    owner,
    course,
    name,
    mime,
    id,
    id,
    'uploaded',
    new Date().toISOString(),
  );
  queue.enqueue(id);
  await settle(id);
  return id;
}

test('PPTX 按放映顺序读出幻灯片文字、解码实体并附上备注', async () => {
  const slides = readSlides(deck);
  assert.equal(slides.length, 2);
  assert.match(slides[0].text, /有限集和无限集/);
  assert.match(slides[0].text, /集合 A & B .*\|A\| < \|B\|/);
  assert.match(slides[1].text, /容斥原理/);
  assert.match(slides[1].notes, /韦恩图/);
  const id = await ingest(deck, PPTX_MIME, '第四章.pptx');
  const pages = db.all<{ number: number; text: string }>(
    'SELECT number,text FROM pages WHERE document_id=? ORDER BY number',
    id,
  );
  assert.equal(pages.length, 2);
  assert.match(pages[1].text, /【备注】\n讲解时先画韦恩图。$/);
  assert.ok(db.get('SELECT 1 FROM points WHERE document_id=?', id));
  assert.throws(() => readSlides(Buffer.from('PK\u0003\u0004 not really a zip')), /损坏|无法读取/);
});

test('重新整理：去掉旧的脏文字，保留学习进度，划线跟着原句移动', async () => {
  const id = await ingest(
    Buffer.from('有限集\n\n有限集合的元素个数是一个自然数。\n\n可数集\n\n与自然数集等势的集合称为可数集。'),
    'text/plain',
    '讲义.txt',
  );
  // simulate text produced by the old pipeline: OCR junk in front of the real content
  const dirty =
    '国庆\n全 中\n' + db.get<{ text: string }>('SELECT text FROM pages WHERE document_id=?', id)!.text;
  db.run('UPDATE pages SET text=? WHERE document_id=?', dirty, id);
  const point = db.get<{ id: string }>('SELECT id FROM points WHERE document_id=? LIMIT 1', id)!;
  db.run("UPDATE points SET state='developing',streak=1,unfamiliar=1,title='我改过的标题' WHERE id=?", point.id);
  const sentence = '与自然数集等势的集合称为可数集。';
  const start = dirty.indexOf(sentence);
  db.run(
    'INSERT INTO highlights(id,owner,document_id,page,start_offset,end_offset,text,created_at) VALUES(?,?,?,1,?,?,?,?)',
    randomUUID(),
    owner,
    id,
    start,
    start + sentence.length,
    sentence,
    new Date().toISOString(),
  );
  db.run(
    'INSERT INTO highlights(id,owner,document_id,page,start_offset,end_offset,text,created_at) VALUES(?,?,?,1,0,2,?,?)',
    randomUUID(),
    owner,
    id,
    '国庆',
    new Date().toISOString(),
  );
  db.run("UPDATE documents SET status='uploaded' WHERE id=?", id);
  queue.enqueue(id);
  assert.equal(await settle(id), 'ready');

  const page = db.get<{ text: string }>('SELECT text FROM pages WHERE document_id=?', id)!.text;
  assert.doesNotMatch(page, /国庆/);
  const kept = db.get<{ title: string; state: string; unfamiliar: number; source_ids: string }>(
    'SELECT title,state,unfamiliar,source_ids FROM points WHERE id=?',
    point.id,
  )!;
  assert.deepEqual([kept.title, kept.state, kept.unfamiliar], ['我改过的标题', 'developing', 1]);
  const chunkIds = new Set(
    db.all<{ id: string }>('SELECT id FROM chunks WHERE document_id=?', id).map((row) => row.id),
  );
  assert.ok(
    (JSON.parse(kept.source_ids) as string[]).every((sid) => chunkIds.has(sid)),
    'sources point at the new passages',
  );
  const marks = db.all<{ start_offset: number; end_offset: number }>(
    'SELECT start_offset,end_offset FROM highlights WHERE document_id=?',
    id,
  );
  assert.equal(marks.length, 1, 'the junk highlight is dropped');
  assert.equal(page.slice(marks[0].start_offset, marks[0].end_offset), sentence);
  const warnings = db.get<{ warnings: string }>('SELECT warnings FROM documents WHERE id=?', id)!.warnings;
  assert.match(warnings, /1 处划线/);
});

test('重新整理：没学过的知识点按新目录重建（打开没答的小测不算学习），学过的保留且不重复', async () => {
  const id = await ingest(
    Buffer.from('1.1 栈\n栈是后进先出的线性表。\n\n1.2 队列\n队列是先进先出的线性表。\n\n1.3 树\n树是分层的非线性结构。'),
    'text/plain',
    '数据结构.txt',
  );
  const before = db.all<{ id: string; title: string }>('SELECT id,title FROM points WHERE document_id=? ORDER BY title', id);
  assert.deepEqual(before.map((point) => point.title), ['1.1 栈', '1.2 队列', '1.3 树']);
  const [stack, queue2] = before;
  db.run("UPDATE points SET state='mastered',streak=2 WHERE id=?", stack.id);
  // a quiz that was opened but never answered
  db.run(
    "INSERT INTO quizzes(id,course_id,point_id,prompt,options,correct_option_id,explanation,source_ids,mode,created_at) VALUES(?,?,?,'题','[]','a','解','[]','source_cloze',?)",
    randomUUID(),
    course,
    queue2.id,
    new Date().toISOString(),
  );
  db.run("UPDATE documents SET status='uploaded' WHERE id=?", id);
  queue.enqueue(id);
  assert.equal(await settle(id), 'ready');
  const after = db.all<{ id: string; title: string; state: string }>(
    'SELECT id,title,state FROM points WHERE document_id=? ORDER BY title',
    id,
  );
  assert.deepEqual(after.map((point) => point.title), ['1.1 栈', '1.2 队列', '1.3 树']);
  assert.equal(after[0].id, stack.id, 'studied point keeps its identity');
  assert.equal(after[0].state, 'mastered');
  assert.notEqual(after[1].id, queue2.id, 'unstudied point is rebuilt');
  assert.equal(db.get<{ n: number }>('SELECT COUNT(*) n FROM quizzes WHERE point_id=?', queue2.id)!.n, 0);
});
