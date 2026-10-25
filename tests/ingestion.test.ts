import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createCanvas } from '@napi-rs/canvas';
import { openDatabase } from '../server/db.ts';
import { config } from '../server/config.ts';
import { createDocumentQueue, stopOCR } from '../server/services/documents.ts';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyu-ingestion-'));
config.dataDir = tempDir;
config.ocrLanguages = 'chi_sim+eng';
fs.mkdirSync(path.join(tempDir, 'uploads'));
const db = openDatabase(path.join(tempDir, 'ingest.sqlite'));
const owner = 'test-owner',
  course = randomUUID();
db.run('INSERT INTO profiles VALUES(?,?,?)', owner, '{}', new Date().toISOString());
db.run(
  'INSERT INTO courses VALUES(?,?,?,?,?,?,?,?,?)',
  course,
  owner,
  'Test',
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
  const start = Date.now();
  while (Date.now() - start < 90000) {
    const row = db.get<{ status: string; error: string | null; page_count: number }>(
      'SELECT status,error,page_count FROM documents WHERE id=?',
      id,
    )!;
    if (['ready', 'partial', 'failed'].includes(row.status)) return { id, ...row };
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error('Ingestion timed out');
}
function imageFixture() {
  const canvas = createCanvas(1000, 380),
    ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 1000, 380);
  ctx.fillStyle = '#111111';
  ctx.font = '32px Arial';
  [
    'Conditional probability',
    'Probability measures uncertainty.',
    'An independent event does not change',
    'the probability of another event.',
  ].forEach((line, index) => ctx.fillText(line, 42, 70 + index * 75));
  ctx.font = '26px "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
  ctx.fillText('条件概率与独立事件', 42, 365);
  return { png: canvas.toBuffer('image/png'), jpeg: canvas.toBuffer('image/jpeg') };
}
function pdfFixture(jpeg: Buffer) {
  const native =
    'BT /F1 17 Tf 40 500 Td (Limits and continuity) Tj 0 -30 Td (A derivative measures an instantaneous rate of change.) Tj 0 -30 Td (Differentiability implies continuity.) Tj ET';
  const objects: Buffer[] = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>'),
    Buffer.from(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 650 600] /Resources << /Font << /F1 6 0 R >> >> /Contents 7 0 R >>',
    ),
    Buffer.from(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 650 600] /Resources << /XObject << /Im0 8 0 R >> >> /Contents 9 0 R >>',
    ),
    Buffer.from(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 650 600] /Resources << /Font << /F1 6 0 R >> /XObject << /Im0 8 0 R >> >> /Contents 10 0 R >>',
    ),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
    Buffer.from(`<< /Length ${Buffer.byteLength(native)} >>\nstream\n${native}\nendstream`),
    Buffer.concat([
      Buffer.from(
        `<< /Type /XObject /Subtype /Image /Width 1000 /Height 380 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
      ),
      jpeg,
      Buffer.from('\nendstream'),
    ]),
  ];
  const imageOps = 'q 580 0 0 220 35 200 cm /Im0 Do Q';
  const mixed = `${native}\n${imageOps}`;
  objects.push(
    Buffer.from(`<< /Length ${imageOps.length} >>\nstream\n${imageOps}\nendstream`),
    Buffer.from(`<< /Length ${mixed.length} >>\nstream\n${mixed}\nendstream`),
  );
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n')],
    offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(parts.reduce((sum, part) => sum + part.length, 0));
    parts.push(Buffer.from(`${i + 1} 0 obj\n`), objects[i], Buffer.from('\nendobj\n'));
  }
  const xref = parts.reduce((sum, part) => sum + part.length, 0);
  parts.push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
        .join('')}trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xref}\n%%EOF`,
    ),
  );
  return Buffer.concat(parts);
}
test('UTF-8 资料建立可定位的知识点与原文索引', async () => {
  const result = await ingest(
    Buffer.from(
      '条件概率\n\n条件概率表示在已知某个事件发生的情况下，另一个事件发生的概率。\n\n独立事件表示一个事件发生不改变另一个事件发生的概率。',
    ),
    'text/plain',
    '中文讲义.txt',
  );
  assert.equal(result.status, 'ready');
  const chunk = db.get<{ text: string; page: number }>(
    'SELECT text,page FROM chunks WHERE document_id=?',
    result.id,
  )!;
  assert.match(chunk.text, /条件概率/);
  assert.equal(chunk.page, 1);
  assert.ok(db.get('SELECT id FROM points WHERE document_id=?', result.id));
});
test('本地 OCR 读取实际图片，PDF 原生页、扫描页和混合页都能检索', { timeout: 120000 }, async () => {
  const fixture = imageFixture();
  const image = await ingest(fixture.png, 'image/png', 'scan.png');
  assert.notEqual(image.status, 'failed', image.error || '');
  const imagePage = db.get<{ text: string; method: string }>(
    'SELECT text,method FROM pages WHERE document_id=?',
    image.id,
  )!;
  assert.equal(imagePage.method, 'ocr');
  assert.match(imagePage.text, /probability/i);
  assert.match(imagePage.text, /概率/);
  const pdf = await ingest(pdfFixture(fixture.jpeg), 'application/pdf', 'mixed.pdf');
  assert.notEqual(pdf.status, 'failed', pdf.error || '');
  assert.equal(pdf.page_count, 3);
  const pages = db.all<{ number: number; text: string; method: string; has_image: number }>(
    'SELECT number,text,method,has_image FROM pages WHERE document_id=? ORDER BY number',
    pdf.id,
  );
  assert.match(pages[0].text, /derivative/i);
  assert.equal(pages[0].method, 'native');
  assert.match(pages[1].text, /probability/i);
  assert.equal(pages[1].method, 'ocr');
  assert.match(pages[2].text, /probability/i);
  assert.equal(pages[2].method, 'ocr');
  assert.equal(pages[2].has_image, 1);
});
test('损坏 PDF 明确失败，不生成假正文', async () => {
  const result = await ingest(Buffer.from('%PDF-1.4\nnot a real PDF'), 'application/pdf', 'broken.pdf');
  assert.equal(result.status, 'failed');
  assert.ok(result.error);
  assert.equal(db.all('SELECT * FROM chunks WHERE document_id=?', result.id).length, 0);
});
