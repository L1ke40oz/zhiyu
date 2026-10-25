import type { Store } from '../db.ts';
import type { Source } from '../../shared/types.ts';
import { embeddings } from './ai.ts';

const stop = new Set([
  '这个',
  '那个',
  '什么',
  '怎么',
  '如何',
  '请问',
  '一下',
  '介绍',
  '解释',
  '可以',
  '课件',
  '资料',
  '内容',
  '关于',
  '为什么',
  '的',
  '是',
  '了',
  '和',
  '在',
  '有',
  '我',
  '你',
  '与',
  'the',
  'what',
  'is',
  'a',
  'of',
  'and',
  'to',
]);
const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
export function tokens(text: string) {
  return [...segmenter.segment(text.toLowerCase())]
    .filter((item) => item.isWordLike && !stop.has(item.segment))
    .map((item) => item.segment);
}
export function cosine(a: number[], b: number[]) {
  if (a.length !== b.length) return 0;
  let dot = 0,
    aa = 0,
    bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] ** 2;
    bb += b[i] ** 2;
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}
export async function retrieve(
  db: Store,
  courseId: string,
  question: string,
  documentId?: string | null,
  page?: number,
  options: { limit?: number; filterDocument?: boolean } = {},
) {
  const filterDocument = options.filterDocument ? documentId || null : null;
  const rows = db.all<Source & { embedding: string | null }>(
    `SELECT c.id,c.document_id AS documentId,d.name AS documentName,c.page,c.text,c.embedding
    FROM chunks c JOIN documents d ON d.id=c.document_id WHERE c.course_id=?
    AND (? IS NULL OR c.document_id=?)`,
    courseId,
    filterDocument,
    filterDocument,
  );
  const query = [...new Set(tokens(question))];
  let queryVector: number[] | null = null;
  let warning: string | null = null;
  try {
    queryVector = (await embeddings([question]))?.[0] || null;
  } catch {
    warning = '向量服务暂不可用，本次使用原文关键词检索。';
  }
  let usedSemantic = false;
  const ranked = rows
    .map((row) => {
      const lower = row.text.toLowerCase();
      const hits = query.filter((token) => lower.includes(token)).length;
      const keyword = query.length ? hits / query.length : 0;
      let semantic = 0;
      if (queryVector && row.embedding) {
        try {
          const vector = JSON.parse(row.embedding);
          if (
            Array.isArray(vector) &&
            vector.length === queryVector.length &&
            vector.every((value) => typeof value === 'number' && Number.isFinite(value))
          ) {
            semantic = cosine(queryVector, vector);
            usedSemantic = true;
          }
        } catch {
          /* old index can be rebuilt */
        }
      }
      const isCurrent = row.documentId === documentId && row.page === page;
      return {
        row,
        relevant: hits > 0 || semantic >= 0.48,
        score: keyword * 0.7 + Math.max(0, semantic) * 0.3 + (isCurrent && hits > 0 ? 0.12 : 0),
      };
    })
    .filter((item) => item.relevant)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(20, options.limit || 5)));
  return {
    sources: ranked.map(({ row: { embedding: _embedding, ...source } }) => source),
    warning,
    mode: usedSemantic ? 'hybrid' : 'keyword',
  };
}
