import { randomInt } from 'node:crypto';
import type { AnswerSection, Source } from '../../shared/types.ts';
import type { Store } from '../db.ts';
import { answerSchema, quizSchema } from '../contracts.ts';
import { config, enabled } from '../config.ts';
import { AppError, assertSourceIds, id, now, sourceRows } from '../domain.ts';
import { structured } from './ai.ts';
import { retrieve, tokens } from './retrieval.ts';
import { currentChatService } from './model-settings.ts';
import type { ReadingQuote } from '../../shared/types.ts';

export async function answerQuestion(
  db: Store,
  courseId: string,
  question: string,
  documentId?: string | null,
  page?: number,
  quote?: ReadingQuote,
) {
  const result = await retrieve(
    db,
    courseId,
    quote ? `${quote.text}\n${question}` : question,
    documentId,
    page,
  );
  if (quote) {
    const pageSources = db.all<{ id: string }>(
      'SELECT id FROM chunks WHERE document_id=? AND page=? ORDER BY rowid',
      quote.documentId,
      quote.page,
    );
    const relevant = sourceRows(
      db,
      courseId,
      pageSources.map((item) => item.id),
    ).filter(
      (source) =>
        source.text.includes(quote.text) ||
        quote.text.includes(source.text) ||
        source.text.includes(quote.text.slice(0, Math.min(40, quote.text.length))),
    );
    const unique = new Map([...relevant.slice(0, 3), ...result.sources].map((source) => [source.id, source]));
    result.sources = [...unique.values()].slice(0, 8);
  }
  const allowed = new Set(result.sources.map((source) => source.id));
  if (!enabled(currentChatService())) {
    const sections: AnswerSection[] = result.sources.length
      ? result.sources.slice(0, 3).map((source) => ({
          text: source.text,
          basis: 'course_material',
          sourceChunkIds: [source.id],
          externalSources: [],
        }))
      : [
          {
            text: '当前资料中未检索到足以支持这部分回答的内容。可以换一个关键词，或补充相关资料。AI 尚未配置，暂时无法提供通用解释。',
            basis: 'general',
            sourceChunkIds: [],
            externalSources: [],
          },
        ];
    return {
      sections,
      sources: result.sources,
      mode: 'extractive' as const,
      insufficientEvidence: !result.sources.length,
      retrievalWarning: result.warning,
    };
  }
  const history = db
    .all<{ role: string; text: string }>(
      'SELECT role,text FROM messages WHERE course_id=? ORDER BY created_at DESC,rowid DESC LIMIT 6',
      courseId,
    )
    .reverse();
  const value = await structured<{
    schemaVersion: number;
    sections: AnswerSection[];
    insufficientEvidence: boolean;
  }>(
    answerSchema,
    '你是温和、清晰的大学课程学习伙伴。先根据给出的证据解释，再帮助用户定位混淆点。资料支持的每段使用 course_material 并引用相关 sourceChunkIds。资料不足时明确说当前资料未检索到充分依据，再使用 general 作通用补充，提醒核实。不能因为检索到片段就假定它支持问题。没有联网能力，不生成网页来源。',
    {
      question,
      selectedPassage: quote || null,
      currentDocumentId: documentId || null,
      currentPage: page || null,
      history,
      sources: result.sources,
    },
    (value) => {
      for (const section of value.sections) {
        if (section.basis === 'course_material')
          assertSourceIds(db, courseId, section.sourceChunkIds, allowed);
        else if (section.sourceChunkIds.length) throw new AppError(422, '通用补充不能伪装成资料引用。');
      }
      if (!result.sources.length && !value.insufficientEvidence)
        throw new AppError(422, '无资料证据时必须标记依据不足。');
      if (
        value.insufficientEvidence &&
        !value.sections.some((section) => section.basis === 'general' && /资料|依据|核实/.test(section.text))
      )
        throw new AppError(422, '依据不足时需要在回答中明确告知。');
    },
  );
  return { ...value, sources: result.sources, mode: 'model' as const, retrievalWarning: result.warning };
}

interface GeneratedQuiz {
  schemaVersion: number;
  prompt: string;
  options: { id: string; text: string }[];
  correctOptionId: string;
  explanation: string;
  sourceChunkIds: string[];
}
export function sourceCloze(sources: Source[], excluded: string[] = []): GeneratedQuiz {
  const candidates = sources.flatMap((source) =>
    source.text
      .split(/(?<=[。！？.!?])\s*|\n+/)
      .filter((line) => line.length >= 16 && line.length <= 320)
      .map((line) => ({ source, line })),
  );
  const words = [
    ...new Set(
      tokens(sources.map((source) => source.text).join('\n')).filter(
        (word) => word.length >= 2 && word.length <= 14,
      ),
    ),
  ];
  if (words.length < 4 || !candidates.length)
    throw new AppError(422, '这段资料还不足以生成可靠的小测，请上传包含完整概念和解释的内容。');
  const possibilities = candidates.flatMap((candidate) =>
    words.filter((word) => candidate.line.includes(word)).map((word) => ({ ...candidate, word })),
  );
  const fresh = possibilities.filter(
    (item) =>
      !excluded.includes(`根据课件原句，空缺处应填什么？\n${item.line.replace(item.word, '________')}`),
  );
  if (!fresh.length) throw new AppError(422, '这部分原文练习已完成，请补充资料或选择其他知识点。');
  const chosen = fresh[randomInt(fresh.length)];
  const distractors = words
    .filter((word) => word !== chosen.word)
    .sort(() => 0.5 - Math.random())
    .slice(0, 3);
  const choices = [chosen.word, ...distractors]
    .map((text) => ({ text, random: randomInt(1_000_000) }))
    .sort((a, b) => a.random - b.random);
  const options = choices.map((choice, index) => ({ id: 'ABCD'[index], text: choice.text }));
  return {
    schemaVersion: 1,
    prompt: `根据课件原句，空缺处应填什么？\n${chosen.line.replace(chosen.word, '________')}`,
    options,
    correctOptionId: options.find((option) => option.text === chosen.word)!.id,
    explanation: `原文写道：“${chosen.line}”\n这是一次原文回忆练习，可以返回课件继续理解概念。`,
    sourceChunkIds: [chosen.source.id],
  };
}
export async function generateQuiz(db: Store, courseId: string, pointId: string) {
  const point = db.get<{ source_ids: string; title: string }>(
    'SELECT source_ids,title FROM points WHERE id=? AND course_id=?',
    pointId,
    courseId,
  );
  if (!point) throw new AppError(404, '没有找到这个知识点。');
  const sources = sourceRows(db, courseId, JSON.parse(point.source_ids));
  if (!sources.length) throw new AppError(422, '这个知识点缺少可核对的资料。');
  const previous = db
    .all<{ prompt: string }>(
      'SELECT prompt FROM quizzes WHERE point_id=? ORDER BY created_at DESC LIMIT 15',
      pointId,
    )
    .map((item) => item.prompt);
  let generated: GeneratedQuiz;
  let mode: 'model' | 'source_cloze';
  if (enabled(currentChatService())) {
    generated = await structured<GeneratedQuiz>(
      quizSchema,
      '只根据证据为目标知识点生成一道大学学习单选题，必须有且只有一个正确答案，选项互斥、题意清晰，考查理解而不是猜测。解释引用原资料，来源不足时不得编造。避免重复先前题目。',
      { title: point.title, sources, previousQuestions: previous.slice(0, 4) },
      (value) => {
        assertSourceIds(db, courseId, value.sourceChunkIds, new Set(sources.map((source) => source.id)));
        if (
          new Set(value.options.map((option) => option.id)).size !== value.options.length ||
          new Set(value.options.map((option) => option.text.trim())).size !== value.options.length ||
          !value.options.some((option) => option.id === value.correctOptionId)
        )
          throw new AppError(422, '题目选项或正确答案不合法。');
        if (previous.includes(value.prompt)) throw new AppError(422, '题目与之前重复。');
      },
    );
    mode = 'model';
  } else {
    generated = sourceCloze(sources, previous);
    mode = 'source_cloze';
  }
  const quizId = id();
  db.run(
    'INSERT INTO quizzes(id,course_id,point_id,prompt,options,correct_option_id,explanation,source_ids,mode,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
    quizId,
    courseId,
    pointId,
    generated.prompt,
    JSON.stringify(generated.options),
    generated.correctOptionId,
    generated.explanation,
    JSON.stringify(generated.sourceChunkIds),
    mode,
    now(),
  );
  return {
    id: quizId,
    pointId,
    courseId,
    prompt: generated.prompt,
    options: generated.options,
    sources: sourceRows(db, courseId, generated.sourceChunkIds),
    mode,
  };
}
