import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { createWorker, type Worker } from 'tesseract.js';
import type { Store } from '../db.ts';
import { config, enabled } from '../config.ts';
import { AppError, id } from '../domain.ts';
import { describePage, embeddings, structured } from './ai.ts';
import { knowledgeSchema } from '../contracts.ts';
import type { DocumentRecord } from '../../shared/types.ts';
import { currentChatService, withOwnerModel } from './model-settings.ts';
import { outline, outlinePoints, sectionChunks } from './structure.ts';
import { readSlides } from './pptx.ts';

export const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
const require = createRequire(import.meta.url);
let ocrWorker: Promise<Worker> | null = null;
async function getOCR() {
  if (!config.ocr) throw new AppError(503, '本地 OCR 已关闭。');
  if (!ocrWorker)
    ocrWorker = (async () => {
      const langDir = path.join(config.dataDir, 'ocr-languages');
      fs.mkdirSync(langDir, { recursive: true });
      for (const language of config.ocrLanguages.split('+')) {
        if (!['eng', 'chi_sim'].includes(language))
          throw new AppError(503, '本地 OCR 当前支持简体中文与英文。');
        const packageDir = path.dirname(require.resolve(`@tesseract.js-data/${language}/package.json`));
        const source = path.join(packageDir, '4.0.0_best_int', `${language}.traineddata.gz`);
        const target = path.join(langDir, `${language}.traineddata.gz`);
        if (!fs.existsSync(target)) fs.copyFileSync(source, target);
      }
      return createWorker(config.ocrLanguages.split('+'), 1, {
        langPath: langDir,
        cachePath: langDir,
        gzip: true,
        errorHandler: () => {
          /* rejection is handled by the ingestion job */
        },
      });
    })().catch((error) => {
      ocrWorker = null;
      throw error;
    });
  return ocrWorker;
}
export async function stopOCR() {
  if (ocrWorker) {
    await (await ocrWorker).terminate();
    ocrWorker = null;
  }
}
interface OcrLine {
  text: string;
  confidence: number;
}
async function recognize(image: Buffer) {
  const result = await (await getOCR()).recognize(image, {}, { text: true, blocks: true });
  const lines: OcrLine[] = (result.data.blocks || []).flatMap((block) =>
    block.paragraphs.flatMap((paragraph) =>
      paragraph.lines.map((line) => ({ text: line.text.trim(), confidence: line.confidence })),
    ),
  );
  return { text: result.data.text.trim(), confidence: result.data.confidence, lines };
}
const normalize = (text: string) => text.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
/**
 * A page with a usable text layer is OCR'd only to catch words inside pictures.
 * Keep OCR lines that are confident, long enough to mean something and not
 * already in the text layer; drop diagram labels and re-read duplicates.
 */
// Comparison units: Chinese character pairs and whole Latin words.
function units(text: string) {
  const result: string[] = [];
  for (const run of text.match(/\p{Script=Han}+/gu) || [])
    for (let i = 0; i < run.length - 1; i++) result.push(run.slice(i, i + 2));
  for (const word of text.toLowerCase().match(/[a-z]{3,}/g) || []) result.push(word);
  return result;
}
/** Whole-page OCR: drop stray marks (lone characters, low-confidence specks, orphan punctuation). */
export function ocrPageText(lines: OcrLine[], fallback: string) {
  if (!lines.length) return fallback;
  return lines
    .map((line) => ({ ...line, text: line.text.replace(/^[“”‘’"'。，、·.,:;：；|]+\s*/u, '').trim() }))
    .filter((line) => {
      const core = normalize(line.text);
      return core.length >= 2 && line.confidence >= 45;
    })
    .map((line) => line.text)
    .join('\n');
}
export function ocrSupplement(native: string, lines: OcrLine[]) {
  const known = new Set(units(cleanText(native)));
  const kept: string[] = [];
  for (const line of lines) {
    const text = cleanText(line.text);
    const core = normalize(text);
    if (line.confidence < 75 || core.length < 6) continue;
    const readable = (core.match(/[\p{Script=Han}a-z0-9]/gu) || []).length / core.length;
    if (readable < 0.8) continue;
    const parts = units(text);
    if (!parts.length) continue;
    const seen = parts.filter((part) => known.has(part)).length;
    if (seen / parts.length > 0.4) continue;
    kept.push(text);
  }
  return kept.join('\n');
}
const singleCjk = /^[\p{Script=Han}，。、；：？！（）“”]$/u;
/**
 * OCR and some PDF text layers space out every Chinese character
 * ("有 限 集 合"). Join runs of two or more single-character tokens, but keep
 * deliberate spaces between words such as "第三章 路由与交换".
 */
function joinSpacedCjk(line: string) {
  const tokens = line.split(/([ \t]+)/);
  for (let i = 0; i < tokens.length; i += 2) {
    if (!singleCjk.test(tokens[i])) continue;
    let end = i;
    while (end + 2 < tokens.length && singleCjk.test(tokens[end + 2])) end += 2;
    if (end > i) for (let k = i + 1; k < end; k += 2) tokens[k] = '';
    i = end;
  }
  return tokens.join('');
}
export function cleanText(text: string) {
  return (
    text
      .replace(/\u0000/g, '')
      .split('\n')
      .map(joinSpacedCjk)
      .join('\n')
      // lines holding nothing but a page number
      .replace(/^[ \t]*(?:第\s*)?\d{1,3}(?:\s*页)?[ \t]*$/gm, '')
      .replace(/[\t ]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}
export function splitText(text: string, limit = 850) {
  const paragraphs = cleanText(text).split(/\n\s*\n|(?<=[。！？.!?])\s*\n/);
  const chunks: string[] = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length > limit) {
      chunks.push(current);
      current = current.slice(-100);
    }
    current += `${current ? '\n' : ''}${paragraph}`;
    while (current.length > limit + 150) {
      chunks.push(current.slice(0, limit));
      current = current.slice(limit - 100);
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter((chunk) => chunk.length >= 12);
}
export function documentRecord(row: Record<string, unknown>): DocumentRecord {
  return {
    id: String(row.id),
    courseId: String(row.course_id),
    name: String(row.name),
    mime: String(row.mime),
    status: row.status as DocumentRecord['status'],
    progress: Number(row.progress),
    pageCount: Number(row.page_count),
    warnings: JSON.parse(String(row.warnings)),
    error: row.error as string | null,
    createdAt: String(row.created_at),
  };
}
type RawDocument = { id: string; course_id: string; filename: string; mime: string; name: string };
export function createDocumentQueue(db: Store) {
  const pending = new Set<string>();
  let running = false;
  async function drain() {
    if (running) return;
    running = true;
    try {
      while (pending.size) {
        const documentId = pending.values().next().value!;
        pending.delete(documentId);
        try {
          const owner = db.get<{ owner: string }>(
            'SELECT owner FROM documents WHERE id=?',
            documentId,
          )?.owner;
          if (owner) await withOwnerModel(db, owner, () => processDocument(db, documentId));
        } catch (error) {
          console.error(
            '[document]',
            documentId,
            error instanceof Error ? error.message : 'processing failed',
          );
          db.run(
            'UPDATE documents SET status=?,error=?,progress=0 WHERE id=?',
            'failed',
            error instanceof AppError ? error.message : '资料处理失败，请重试或换成清晰 PDF／图片。',
            documentId,
          );
        }
      }
    } finally {
      running = false;
    }
  }
  return {
    enqueue(documentId: string) {
      pending.add(documentId);
      void drain();
    },
    resume() {
      for (const row of db.all<{ id: string }>(
        "SELECT id FROM documents WHERE status IN ('uploaded','parsing','indexing')",
      ))
        pending.add(row.id);
      void drain();
    },
    get busy() {
      return running;
    },
  };
}
/** Points the learner has already worked with must survive a re-process. */
/**
 * Points the learner has actually worked with (progress, flagged, answered a
 * quiz, linked a stuck note). Only these survive a re-process; merely opening
 * a quiz does not count.
 */
function studiedPoints(db: Store, documentId: string) {
  return db.all<{ id: string; title: string }>(
    `SELECT p.id,p.title FROM points p WHERE p.document_id=? AND (
      p.state!='unexplored' OR p.streak>0 OR p.unfamiliar=1
      OR EXISTS (SELECT 1 FROM quizzes q JOIN attempts a ON a.quiz_id=q.id WHERE q.point_id=p.id)
      OR EXISTS (SELECT 1 FROM stuck s WHERE s.point_id=p.id)
    )`,
    documentId,
  );
}
/** Map each old passage to the most similar new passage (same page preferred). */
export function matchChunks(
  previous: { id: string; page: number; text: string }[],
  next: { id: string; page: number; text: string }[],
) {
  const mapping = new Map<string, string>();
  if (!next.length) return mapping;
  const nextUnits = next.map((chunk) => new Set(units(chunk.text)));
  for (const old of previous) {
    const mine = units(old.text);
    let best = 0,
      bestScore = -Infinity;
    next.forEach((chunk, index) => {
      const shared = mine.filter((unit) => nextUnits[index].has(unit)).length;
      const score = shared / Math.max(1, mine.length) - Math.abs(chunk.page - old.page) * 0.05;
      if (score > bestScore) {
        bestScore = score;
        best = index;
      }
    });
    mapping.set(old.id, next[best].id);
  }
  return mapping;
}
/** Find a highlighted sentence again in re-extracted text. */
export function relocate(quote: { page: number; text: string }, pages: { number: number; text: string }[]) {
  const variants = [...new Set([quote.text, cleanText(quote.text)])].filter(Boolean);
  const ordered = [...pages].sort(
    (a, b) => Math.abs(a.number - quote.page) - Math.abs(b.number - quote.page),
  );
  for (const page of ordered)
    for (const text of variants) {
      const start = page.text.indexOf(text);
      if (start >= 0) return { page: page.number, start, end: start + text.length, text };
    }
  return null;
}
async function processDocument(db: Store, documentId: string) {
  const doc = db.get<RawDocument>('SELECT * FROM documents WHERE id=?', documentId);
  if (!doc) return;
  const studied = studiedPoints(db, documentId);
  db.run("UPDATE documents SET status='parsing',progress=5,error=NULL WHERE id=?", documentId);
  const bytes = fs.readFileSync(path.join(config.dataDir, 'uploads', doc.filename));
  const pageDir = path.join(config.dataDir, 'pages', documentId);
  fs.mkdirSync(pageDir, { recursive: true });
  const warnings: string[] = [];
  const pages: { number: number; text: string; method: string; warning: string | null; hasImage: boolean }[] =
    [];
  if (doc.mime === 'application/pdf') {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
    const pdf = await loadingTask.promise;
    try {
      if (pdf.numPages > 50) throw new AppError(413, 'PDF 超过 50 页，请拆分后上传。');
      for (let number = 1; number <= pdf.numPages; number++) {
        const page = await pdf.getPage(number);
        const content = await page.getTextContent();
        const native = cleanText(
          content.items
            .map((item) => ('str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : ''))
            .join(''),
        );
        const ops = await page.getOperatorList();
        const hasImage = ops.fnArray.some((op) =>
          [
            pdfjs.OPS.paintImageXObject,
            pdfjs.OPS.paintInlineImageXObject,
            pdfjs.OPS.paintImageMaskXObject,
          ].includes(op),
        );
        const viewport = page.getViewport({
          scale: Math.min(1.65, 1800 / Math.max(page.view[2] - page.view[0], page.view[3] - page.view[1])),
        });
        if (viewport.width * viewport.height > 8_000_000)
          throw new AppError(413, 'PDF 页面尺寸过大，请缩小页面后上传。');
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await page.render({
          canvas: canvas as never,
          canvasContext: canvas.getContext('2d') as never,
          viewport,
        }).promise;
        const png = canvas.toBuffer('image/png');
        fs.writeFileSync(path.join(pageDir, `${number}.png`), png);
        let text = native,
          method = native.length >= 12 ? 'native' : 'unreadable',
          warning: string | null = null;
        if (native.length < 80 || hasImage) {
          try {
            const result = await recognize(png);
            if (native.length >= 80) {
              // the text layer is authoritative; only add words found inside pictures
              const extra = ocrSupplement(native, result.lines);
              if (extra) {
                text = `${native}\n\n【图中文字】\n${extra}`;
                method = 'ocr';
              }
            } else if (result.text.length >= 12) {
              text = ocrPageText(result.lines, result.text);
              method = 'ocr';
              if (result.confidence < 65) warning = '本页识别结果可能不完整，请对照原图核实。';
            } else warning = '本页未能识别出足够文字，请对照原图。';
          } catch {
            warning = '本页 OCR 未完成，已保留可提取文字与原图。';
          }
          if (warning || text.length < 12) {
            try {
              const vision = await describePage(png);
              if (vision && vision.length >= 12) {
                text = vision;
                method = 'vision';
                warning = '视觉模型转写，请对照原图核实公式与图表关系。';
              }
            } catch {
              warning = `${warning || ''} 视觉识别暂不可用。`.trim();
            }
          }
        }
        if (hasImage && !warning) warning = '含图片的页面；图表关系与复杂公式请对照原图。';
        pages.push({ number, text: cleanText(text), method, warning, hasImage });
        db.run(
          'UPDATE documents SET progress=?,page_count=? WHERE id=?',
          Math.round(5 + (number / pdf.numPages) * 70),
          pdf.numPages,
          documentId,
        );
        page.cleanup();
      }
    } finally {
      await loadingTask.destroy();
    }
  } else if (doc.mime.startsWith('image/')) {
    const { loadImage } = await import('@napi-rs/canvas');
    const image = await loadImage(bytes);
    if (image.width * image.height > 40_000_000) throw new AppError(413, '图片尺寸过大，请压缩后上传。');
    const scale = Math.min(1, 2200 / Math.max(image.width, image.height));
    const canvas = createCanvas(
      Math.max(1, Math.round(image.width * scale)),
      Math.max(1, Math.round(image.height * scale)),
    );
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = canvas.toBuffer('image/png');
    fs.writeFileSync(path.join(pageDir, '1.png'), png);
    let text = '',
      method = 'unreadable',
      warning: string | null = null;
    try {
      const result = await recognize(png);
      text = ocrPageText(result.lines, result.text);
      method = text.length >= 12 ? 'ocr' : 'unreadable';
      if (result.confidence < 65) warning = '图片识别置信度较低，请对照原图核实。';
    } catch {
      warning = '本地 OCR 未完成，请重试或提供清晰图片。';
    }
    if (warning || text.length < 12) {
      try {
        const vision = await describePage(png);
        if (vision) {
          text = vision;
          method = 'vision';
          warning = '视觉模型转写，请对照原图核实。';
        }
      } catch {
        /* retain original and actual failure */
      }
    }
    pages.push({ number: 1, text: cleanText(text), method, warning, hasImage: true });
  } else if (doc.mime === PPTX_MIME) {
    const { loadImage } = await import('@napi-rs/canvas');
    const slides = readSlides(bytes);
    let ocrBudget = 40;
    for (const slide of slides) {
      let text = cleanText(slide.text);
      let method = 'native',
        warning: string | null = null;
      // words inside pictures on the slide (screenshots, scanned formulas...)
      const pictureText: string[] = [];
      for (const picture of slide.images) {
        if (ocrBudget <= 0) break;
        try {
          const image = await loadImage(picture.data);
          if (image.width < 200 || image.height < 80) continue;
          ocrBudget--;
          const scale = Math.min(1, 2200 / Math.max(image.width, image.height));
          const canvas = createCanvas(Math.round(image.width * scale), Math.round(image.height * scale));
          canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
          const result = await recognize(canvas.toBuffer('image/png'));
          const extra =
            text.length >= 80
              ? ocrSupplement(`${text}\n${pictureText.join('\n')}`, result.lines)
              : ocrPageText(result.lines, '');
          if (extra.trim()) pictureText.push(extra);
        } catch {
          warning = '幻灯片中有图片未能识别，请对照原文件核实。';
        }
      }
      if (pictureText.length) {
        text = `${text}${text ? '\n\n' : ''}【图中文字】\n${pictureText.join('\n')}`;
        method = slide.text.trim() ? 'native' : 'ocr';
      }
      const notes = cleanText(slide.notes);
      if (notes) text = `${text}${text ? '\n\n' : ''}【备注】\n${notes}`;
      if (!text.trim()) {
        method = 'unreadable';
        warning = warning || '这页幻灯片没有可提取的文字。';
      }
      pages.push({ number: slide.number, text, method, warning, hasImage: slide.images.length > 0 });
      db.run(
        'UPDATE documents SET progress=?,page_count=? WHERE id=?',
        Math.round(5 + (slide.number / slides.length) * 70),
        slides.length,
        documentId,
      );
    }
  } else {
    const text = cleanText(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!text || text.includes('\uFFFD'))
      throw new AppError(422, '文本编码无法读取，请保存为 UTF-8 后上传。');
    const segments = text.match(/[\s\S]{1,6000}/g) || [];
    if (segments.length > 50) throw new AppError(413, '文本内容过长，请拆分上传。');
    segments.forEach((segment, index) =>
      pages.push({ number: index + 1, text: segment, method: 'native', warning: null, hasImage: false }),
    );
  }
  // Remove only repeated short lines at page edges; never discard repeated definitions in the body.
  const edgeCounts = new Map<string, number>();
  for (const page of pages) {
    const lines = page.text.split('\n').filter(Boolean);
    for (const line of new Set([...lines.slice(0, 1), ...lines.slice(-1)]))
      if (line.length < 70) edgeCounts.set(line, (edgeCounts.get(line) || 0) + 1);
  }
  if (pages.length >= 3)
    for (const page of pages) {
      const lines = page.text.split('\n');
      page.text = lines
        .filter(
          (line, index) =>
            !(
              (index === 0 || index === lines.length - 1) &&
              (edgeCounts.get(line) || 0) >= Math.max(3, Math.ceil(pages.length * 0.7))
            ),
        )
        .join('\n');
    }
  const chunks = pages.flatMap((page) =>
    sectionChunks(page.text).map((section) => ({ id: id(), page: page.number, ...section })),
  );
  if (!chunks.length) warnings.push('没有提取出可检索内容；可以查看原图，或换清晰资料重试。');
  if (pages.some((page) => page.warning)) warnings.push('部分页面需对照原图核实，识别状态显示在阅读器中。');
  db.run("UPDATE documents SET status='indexing',progress=80 WHERE id=?", documentId);
  let vectors: number[][] | null = null;
  try {
    vectors = [];
    for (let offset = 0; offset < chunks.length; offset += 24) {
      const batch = await embeddings(chunks.slice(offset, offset + 24).map((chunk) => chunk.text));
      if (!batch) {
        vectors = null;
        break;
      }
      vectors.push(...batch);
    }
  } catch {
    vectors = null;
    warnings.push('向量索引暂未完成，当前可使用原文关键词检索。');
  }
  type KnowledgeCandidate = { title: string; groupIndex: number; sourceChunkIds: string[] };
  let knowledge: KnowledgeCandidate[] | null = null;
  if (chunks.length && enabled(currentChatService())) {
    // cover every section first, then fill up with evenly spaced passages
    const firstOfSection = outline(pages)
      .filter((section) => !section.meta)
      .map((section) => chunks.find((chunk) => section.pages.includes(chunk.page)))
      .filter((chunk): chunk is (typeof chunks)[number] => Boolean(chunk));
    const evenly =
      chunks.length <= 24
        ? chunks
        : Array.from({ length: 24 }, (_, index) => chunks[Math.floor((index * chunks.length) / 24)]);
    const evidence = [...new Set([...firstOfSection, ...evenly])].slice(0, 24);
    const allowed = new Set<string>(evidence.map((chunk) => chunk.id));
    try {
      const generated = await structured<{ schemaVersion: number; items: KnowledgeCandidate[] }>(
        knowledgeSchema,
        '从课程资料中提取最多九个值得复习的知识点，标题简短具体。把相近知识点归入最多三个知识区域，用 groupIndex 0、1、2 表示。每个知识点必须引用真实来源块，不补造资料中没有的主题。',
        { documentName: doc.name, chunks: evidence },
        (result) => {
          if (result.items.some((item) => item.sourceChunkIds.some((sourceId) => !allowed.has(sourceId))))
            throw new AppError(422, '知识点来源不属于本次提供的资料。');
        },
      );
      knowledge = generated.items;
    } catch {
      warnings.push('AI 知识点整理暂未完成，先按原文分段保留，可在课程岛修改名称。');
    }
  }
  // without a model: one point per section of the material's own outline
  if (!knowledge) knowledge = outlinePoints(pages, chunks);
  if (!knowledge) {
    const sampleCount = Math.min(9, chunks.length);
    knowledge = Array.from({ length: sampleCount }, (_, index) => {
      const chunk = chunks[Math.floor((index * chunks.length) / sampleCount)];
      return {
        title:
          chunk.title ||
          `第 ${chunk.page} 页阅读要点${chunks.filter((item) => item.page === chunk.page).length > 1 ? ` · ${chunks.filter((item) => item.page === chunk.page).indexOf(chunk) + 1}` : ''}`,
        groupIndex: index % 3,
        sourceChunkIds: [chunk.id],
      };
    });
  }
  db.transaction(() => {
    // drop points nobody has studied yet (and quizzes opened but never answered) ...
    const keep = new Set(studied.map((point) => point.id));
    for (const point of db.all<{ id: string }>('SELECT id FROM points WHERE document_id=?', documentId))
      if (!keep.has(point.id)) {
        db.run('DELETE FROM quizzes WHERE point_id=?', point.id);
        db.run('DELETE FROM points WHERE id=?', point.id);
      }
    if (studied.length) {
      // ... and keep the studied ones, re-pointing their sources at the new passages
      const previous = db.all<{ id: string; page: number; text: string }>(
        'SELECT id,page,text FROM chunks WHERE document_id=?',
        documentId,
      );
      const mapping = matchChunks(previous, chunks);
      const remap = (json: string) =>
        JSON.stringify([...new Set((JSON.parse(json) as string[]).map((sid) => mapping.get(sid) || sid))]);
      for (const point of db.all<{ id: string; source_ids: string }>(
        'SELECT id,source_ids FROM points WHERE document_id=?',
        documentId,
      ))
        db.run('UPDATE points SET source_ids=? WHERE id=?', remap(point.source_ids), point.id);
      for (const quiz of db.all<{ id: string; source_ids: string }>(
        'SELECT q.id,q.source_ids FROM quizzes q JOIN points p ON p.id=q.point_id WHERE p.document_id=?',
        documentId,
      ))
        db.run('UPDATE quizzes SET source_ids=? WHERE id=?', remap(quiz.source_ids), quiz.id);
    }
    db.run('DELETE FROM chunks WHERE document_id=?', documentId);
    db.run('DELETE FROM pages WHERE document_id=?', documentId);
    for (const page of pages)
      db.run(
        'INSERT INTO pages(document_id,number,text,method,warning,has_image) VALUES(?,?,?,?,?,?)',
        documentId,
        page.number,
        page.text,
        page.method,
        page.warning,
        page.hasImage ? 1 : 0,
      );
    chunks.forEach((chunk, index) =>
      db.run(
        'INSERT INTO chunks(id,document_id,course_id,page,text,embedding) VALUES(?,?,?,?,?,?)',
        chunk.id,
        documentId,
        doc.course_id,
        chunk.page,
        chunk.text,
        vectors ? JSON.stringify(vectors[index]) : null,
      ),
    );
    // highlights follow their sentence into the new text; ones that vanished are dropped
    let lost = 0;
    for (const mark of db.all<{ id: string; page: number; text: string }>(
      'SELECT id,page,text FROM highlights WHERE document_id=?',
      documentId,
    )) {
      const found = relocate(mark, pages);
      if (!found) {
        db.run('DELETE FROM highlights WHERE id=?', mark.id);
        lost++;
        continue;
      }
      const clash = db.get(
        'SELECT 1 FROM highlights WHERE id!=? AND document_id=? AND page=? AND start_offset=? AND end_offset=?',
        mark.id,
        documentId,
        found.page,
        found.start,
        found.end,
      );
      if (clash) db.run('DELETE FROM highlights WHERE id=?', mark.id);
      else
        db.run(
          'UPDATE highlights SET page=?,start_offset=?,end_offset=?,text=? WHERE id=?',
          found.page,
          found.start,
          found.end,
          found.text,
          mark.id,
        );
    }
    if (lost) warnings.push(`重新整理后有 ${lost} 处划线在新文字里找不到，已移除。`);
    const keptTitles = new Set(studied.map((point) => point.title));
    for (const point of knowledge.filter((item) => !keptTitles.has(item.title))) {
      db.run(
        'INSERT INTO points(id,course_id,document_id,title,group_index,source_ids) VALUES(?,?,?,?,?,?)',
        id(),
        doc.course_id,
        documentId,
        point.title,
        point.groupIndex,
        JSON.stringify(point.sourceChunkIds),
      );
    }
    db.run(
      'UPDATE documents SET status=?,progress=100,page_count=?,warnings=?,error=NULL WHERE id=?',
      pages.some((page) => page.method === 'unreadable') || !chunks.length ? 'partial' : 'ready',
      pages.length,
      JSON.stringify(warnings),
      documentId,
    );
  });
}
