import type { Store } from '../db.ts';

function heading(line: string) {
  const value = line.trim();
  if (!value || value.length > 60) return null;
  if (/^#{1,6}\s+/.test(value)) return value.replace(/^#+\s*/, '').trim();
  if (
    /^(?:第[一二三四五六七八九十百\d]+[章节部分]|[一二三四五六七八九十]+[、.]|\d+(?:\.\d+)*[、.\s])/.test(
      value,
    ) &&
    !/[。！？；]/.test(value)
  )
    return value;
  return null;
}
function standaloneHeading(lines: string[], index: number) {
  const value = lines[index].trim();
  if (heading(value)) return heading(value);
  if (
    value.length >= 3 &&
    value.length <= 28 &&
    !/[，。！？；：,.!?;:]/.test(value) &&
    (index === 0 || !lines[index - 1].trim()) &&
    (index === lines.length - 1 || !lines[index + 1].trim())
  )
    return value.replace(/^#+\s*/, '');
  return null;
}
export function readableTitle(text: string, fallback = '本页阅读要点') {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const explicit = lines.map(heading).find(Boolean);
  if (explicit) return explicit;
  const first = lines[0]?.replace(/^#+\s*/, '') || '';
  if (first.length >= 3 && first.length <= 32 && !/[，。！？；：]/.test(first)) return first;
  const sentence = first.match(/^(.{3,32}?)[。！？]/)?.[1];
  return sentence || fallback;
}
export function sectionChunks(text: string, limit = 850) {
  const sections: { title: string; text: string }[] = [];
  let title = '',
    lines: string[] = [];
  function flush() {
    const body = lines.join('\n').trim();
    if (body) sections.push({ title: title || readableTitle(body, ''), text: body });
    lines = [];
  }
  const rawLines = text.split('\n');
  for (const [index, line] of rawLines.entries()) {
    const next = standaloneHeading(rawLines, index);
    if (next) {
      flush();
      title = next;
    }
    lines.push(line);
  }
  flush();
  return sections.flatMap((section) => {
    const sentences = section.text.match(/[^。！？.!?\n]+(?:[。！？.!?]+|\n|$)|\n/g) || [section.text];
    const blocks: string[] = [];
    let current = '';
    for (const sentence of sentences) {
      if (current && current.length + sentence.length > limit) {
        blocks.push(current.trim());
        current = '';
      }
      // Exceptionally long unpunctuated material remains bounded; its title still comes from the section.
      for (let offset = 0; offset < sentence.length; offset += limit) {
        const part = sentence.slice(offset, offset + limit);
        if (current && current.length + part.length > limit) {
          blocks.push(current.trim());
          current = '';
        }
        current += part;
      }
    }
    if (current.trim()) blocks.push(current.trim());
    return blocks
      .filter((body) => body.length >= 12)
      .map((body, index) => ({
        text: body,
        title: section.title ? `${section.title}${blocks.length > 1 ? ` · ${index + 1}` : ''}` : '',
      }));
  });
}
export function repairLegacyTitles(db: Store) {
  const rows = db.all<{ id: string; title: string; source_ids: string; document_id: string }>(
    'SELECT id,title,source_ids,document_id FROM points',
  );
  for (const row of rows) {
    const sourceId = JSON.parse(row.source_ids)[0];
    if (typeof sourceId !== 'string') continue;
    const chunk = db.get<{ text: string; page: number }>('SELECT text,page FROM chunks WHERE id=?', sourceId);
    if (!chunk) continue;
    const old = (
      chunk.text.split(/[\n。！？]/).find((line) => line.trim().length >= 3) || `第 ${chunk.page} 页知识点`
    )
      .replace(/^#+\s*/, '')
      .trim()
      .slice(0, 36);
    if (row.title !== old) continue; // Keep model-generated or user-renamed titles and all learning evidence.
    const page =
      db.get<{ text: string }>(
        'SELECT text FROM pages WHERE document_id=? AND number=?',
        row.document_id,
        chunk.page,
      )?.text || chunk.text;
    const offset = page.indexOf(chunk.text),
      preceding = offset >= 0 ? page.slice(0, offset) : '';
    const nearest = preceding.split('\n').map(heading).filter(Boolean).at(-1);
    const title = readableTitle(chunk.text, nearest || `第 ${chunk.page} 页阅读要点`);
    if (title !== row.title) db.run('UPDATE points SET title=? WHERE id=?', title, row.id);
  }
}

// ---------- outline-based knowledge points (used when no model is configured) ----------
const META = /教学要求|课程要求|课程介绍|课程简介|主要内容|本章内容|目录|学习目标|教学目标|考核|参考(书|文献|资料)|谢谢|致谢|Q\s*&\s*A|提问/i;
/** A slide/page title such as "1.2 Java 的特点" or "第1章 Java入门"; list items like "3. 运行" are not. */
export function sectionHeading(line: string) {
  const value = line.trim();
  if (!value || value.length > 40 || /[。！？；]/.test(value)) return null;
  const dotted = value.match(/^(\d+(?:\.\d+){1,3})\s*[、.．]?\s*(\S.*)$/);
  if (dotted) return { key: dotted[1], title: `${dotted[1]} ${dotted[2].trim()}` };
  const chapter = value.match(/^(第\s*[一二三四五六七八九十百\d]+\s*[章节部分讲])\s*[:：、.．]?\s*(.*)$/);
  if (chapter) {
    const key = chapter[1].replace(/\s+/g, '');
    return { key, title: chapter[2] ? `${key} ${chapter[2].trim()}` : key };
  }
  const markdown = value.match(/^#{1,3}\s+(.+)$/);
  if (markdown) return { key: markdown[1].trim(), title: markdown[1].trim() };
  return null;
}
export interface OutlineSection {
  key: string;
  title: string;
  pages: number[];
  meta: boolean;
}
/** Consecutive pages that share a title form one section; repeated titles merge. */
export function outline(pages: { number: number; text: string }[]) {
  const sections: OutlineSection[] = [];
  const byKey = new Map<string, OutlineSection>();
  let current: OutlineSection | null = null;
  for (const page of [...pages].sort((a, b) => a.number - b.number)) {
    const lines = page.text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const found = lines.slice(0, 2).map(sectionHeading).find(Boolean) || null;
    const meta = lines.slice(0, 2).some((line) => META.test(line) && line.length <= 20);
    if (found) {
      const existing = byKey.get(found.key);
      if (existing) {
        existing.pages.push(page.number);
        current = existing;
        continue;
      }
      current = { key: found.key, title: found.title, pages: [page.number], meta };
      byKey.set(found.key, current);
      sections.push(current);
    } else if (current && !meta) current.pages.push(page.number);
    else {
      current = { key: `page-${page.number}`, title: readableTitle(page.text, `第 ${page.number} 页`), pages: [page.number], meta };
      sections.push(current);
    }
  }
  return sections;
}
const chapterOf = (key: string) => key.match(/^(\d+)\./)?.[1] || key.match(/^第(.+?)[章节部分讲]/)?.[1] || null;
/**
 * One knowledge point per real section, citing all of its passages. Returns
 * null when the material has no usable section titles (plain notes), so the
 * caller can fall back to passage sampling.
 */
export function outlinePoints(
  pages: { number: number; text: string }[],
  chunks: { id: string; page: number }[],
  limit = 30,
) {
  const sections = outline(pages);
  if (sections.filter((section) => !section.key.startsWith('page-')).length < 2) return null;
  const usable = sections
    .filter((section) => !section.meta)
    .map((section) => ({
      ...section,
      chunkIds: chunks.filter((chunk) => section.pages.includes(chunk.page)).map((chunk) => chunk.id),
    }))
    .filter((section) => section.chunkIds.length)
    .slice(0, limit);
  if (!usable.length) return null;
  // regions: by chapter when the material spans several, otherwise three bands in reading order
  const chapters = [...new Set(usable.map((section) => chapterOf(section.key)).filter(Boolean))];
  return usable.map((section, index) => {
    const chapter = chapters.indexOf(chapterOf(section.key) || '');
    const groupIndex =
      chapters.length >= 2 && chapter >= 0
        ? Math.min(chapter, 2)
        : Math.min(2, Math.floor((index * Math.min(3, usable.length)) / usable.length));
    const ids = section.chunkIds;
    const sourceChunkIds =
      ids.length <= 12 ? ids : Array.from({ length: 12 }, (_, k) => ids[Math.floor((k * ids.length) / 12)]);
    return { title: section.title.slice(0, 80), groupIndex, sourceChunkIds };
  });
}
