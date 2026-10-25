// Minimal PPTX reader: a .pptx is a ZIP of XML parts. We only need slide text,
// speaker notes and the pictures each slide references, so a small central
// directory reader built on node:zlib is enough (no extra dependency).
import zlib from 'node:zlib';
import path from 'node:path';
import { AppError } from '../domain.ts';

const MAX_ENTRY = 40 * 1024 * 1024;

export function readZip(bytes: Buffer) {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (bytes.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new AppError(422, 'PPTX 文件已损坏或不是有效的演示文稿。');
  const count = bytes.readUInt16LE(eocd + 10),
    offset = bytes.readUInt32LE(eocd + 16);
  if (offset === 0xffffffff) throw new AppError(413, '演示文稿过大，请拆分或导出 PDF 后上传。');
  const entries = new Map<string, { method: number; size: number; packed: number; local: number }>();
  let p = offset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || bytes.readUInt32LE(p) !== 0x02014b50)
      throw new AppError(422, 'PPTX 文件目录无法读取。');
    const method = bytes.readUInt16LE(p + 10),
      packed = bytes.readUInt32LE(p + 20),
      size = bytes.readUInt32LE(p + 24),
      nameLength = bytes.readUInt16LE(p + 28),
      extraLength = bytes.readUInt16LE(p + 30),
      commentLength = bytes.readUInt16LE(p + 32),
      local = bytes.readUInt32LE(p + 42);
    const name = bytes.subarray(p + 46, p + 46 + nameLength).toString('utf8');
    entries.set(name, { method, size, packed, local });
    p += 46 + nameLength + extraLength + commentLength;
  }
  return {
    has: (name: string) => entries.has(name),
    names: () => [...entries.keys()],
    read(name: string) {
      const entry = entries.get(name);
      if (!entry) return null;
      if (entry.size > MAX_ENTRY) throw new AppError(413, '演示文稿中的单个文件过大。');
      const at = entry.local;
      if (bytes.readUInt32LE(at) !== 0x04034b50) throw new AppError(422, 'PPTX 文件内容无法读取。');
      const start = at + 30 + bytes.readUInt16LE(at + 26) + bytes.readUInt16LE(at + 28);
      const data = bytes.subarray(start, start + entry.packed);
      if (entry.method === 0) return Buffer.from(data);
      if (entry.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: MAX_ENTRY });
      throw new AppError(422, 'PPTX 使用了不支持的压缩方式，请导出 PDF 后上传。');
    },
  };
}

function decode(text: string) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Paragraph text of a DrawingML part: one line per <a:p>, <a:br/> becomes a newline. */
export function drawingText(xml: string) {
  const lines: string[] = [];
  for (const paragraph of xml.match(/<a:p[ >][\s\S]*?<\/a:p>/g) || []) {
    const line = (paragraph.match(/<a:t(?:\s[^>]*)?>[\s\S]*?<\/a:t>|<a:br\s*\/>/g) || [])
      .map((piece) => (piece.startsWith('<a:br') ? '\n' : decode(piece.replace(/<[^>]+>/g, ''))))
      .join('')
      .trim();
    if (line) lines.push(line);
  }
  return lines.join('\n');
}

function relationships(xml: string | undefined, base: string) {
  const map = new Map<string, string>();
  for (const rel of xml?.match(/<Relationship\b[^>]*>/g) || []) {
    const id = rel.match(/\bId="([^"]+)"/)?.[1],
      target = rel.match(/\bTarget="([^"]+)"/)?.[1],
      external = /TargetMode="External"/.test(rel);
    if (id && target && !external) map.set(id, path.posix.normalize(path.posix.join(base, target)));
  }
  return map;
}

export interface Slide {
  number: number;
  text: string;
  notes: string;
  images: { name: string; data: Buffer }[];
}

export function readSlides(bytes: Buffer, maxSlides = 50): Slide[] {
  const zip = readZip(bytes);
  const xml = (name: string) => zip.read(name)?.toString('utf8');
  if (!zip.has('ppt/presentation.xml')) throw new AppError(422, '这不是 PowerPoint 演示文稿（.pptx）。');
  // presentation order comes from sldIdLst, not from file names
  const presRels = relationships(xml('ppt/_rels/presentation.xml.rels'), 'ppt');
  const order = (xml('ppt/presentation.xml')?.match(/<p:sldId\b[^>]*>/g) || [])
    .map((tag) => presRels.get(tag.match(/r:id="([^"]+)"/)?.[1] || ''))
    .filter((name): name is string => Boolean(name && zip.has(name)));
  const slides = order.length
    ? order
    : zip
        .names()
        .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
        .sort((a, b) => Number(a.match(/\d+/g)!.at(-1)) - Number(b.match(/\d+/g)!.at(-1)));
  if (!slides.length) throw new AppError(422, '演示文稿里没有找到幻灯片。');
  if (slides.length > maxSlides) throw new AppError(413, `演示文稿超过 ${maxSlides} 页，请拆分后上传。`);
  return slides.map((name, index) => {
    const dir = path.posix.dirname(name),
      base = path.posix.basename(name);
    const rels = relationships(xml(`${dir}/_rels/${base}.rels`), dir);
    const body = xml(name) || '';
    const notesName = [...rels.values()].find((target) => target.includes('notesSlide'));
    // slide-number placeholders in notes become number-only lines, which cleanText drops
    const notes = notesName ? drawingText(xml(notesName) || '') : '';
    const images = [...(body.match(/r:embed="([^"]+)"/g) || [])]
      .map((attr) => rels.get(attr.slice(9, -1)))
      .filter((target): target is string => Boolean(target && /\.(png|jpe?g)$/i.test(target)))
      .filter((target, i, all) => all.indexOf(target) === i)
      .slice(0, 3)
      .map((target) => ({ name: target, data: zip.read(target)! }))
      .filter((image) => image.data);
    return { number: index + 1, text: drawingText(body), notes, images };
  });
}
