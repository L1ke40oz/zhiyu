import type { Express, Request, RequestHandler } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { ReadingQuote } from '../shared/types.ts';
import type { Store } from './db.ts';
import { config, enabled } from './config.ts';
import { AppError, id, now, requireCourse } from './domain.ts';
import { retrieve } from './services/retrieval.ts';
import { answerQuestion } from './services/learning.ts';
import { runAssistantWork } from './services/assistant-work.ts';
import { currentVisionService } from './services/model-settings.ts';

export function messageImages(db: Store, owner: string, courseId: string) {
  const images = new Map<string, { id: string; name: string; url: string }[]>();
  for (const image of db.all<{ id: string; message_id: string; name: string }>(
    'SELECT id,message_id,name FROM chat_images WHERE owner=? AND course_id=?',
    owner,
    courseId,
  )) {
    const list = images.get(image.message_id) || [];
    list.push({ id: image.id, name: image.name, url: `/api/chat-images/${image.id}` });
    images.set(image.message_id, list);
  }
  return images;
}

export function installReaderTools(
  app: Express,
  db: Store,
  modelLimit: RequestHandler,
  quoteFor: (req: Request, value: unknown) => ReadingQuote,
) {
  app.get('/api/courses/:courseId/search', modelLimit, async (req, res) => {
    const courseId = String(req.params.courseId);
    requireCourse(db, req.owner, courseId);
    const query = req.query.q;
    if (typeof query !== 'string' || !query.trim() || query.length > 300)
      throw new AppError(422, '请输入 1–300 字的检索内容。');
    const documentId = req.query.documentId;
    if (
      documentId !== undefined &&
      (typeof documentId !== 'string' ||
        !db.get('SELECT id FROM documents WHERE id=? AND course_id=?', documentId, courseId))
    )
      throw new AppError(422, '检索范围不属于当前课程。');
    res.json(
      await retrieve(db, courseId, query.trim(), documentId as string | undefined, undefined, {
        limit: 10,
        filterDocument: Boolean(documentId),
      }),
    );
  });

  app.get('/api/chat-images/:imageId', (req, res) => {
    const image = db.get<{ filename: string }>(
      'SELECT filename FROM chat_images WHERE id=? AND owner=?',
      String(req.params.imageId),
      req.owner,
    );
    if (!image) throw new AppError(404, '图片不存在或不属于当前学习空间。');
    res.type('png').sendFile(path.join(config.dataDir, 'chat-images', image.filename));
  });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 5 },
  }).single('image');
  app.post(
    '/api/courses/:courseId/ask-image',
    modelLimit,
    (req, res, next) => {
      try {
        requireCourse(db, req.owner, String(req.params.courseId));
        if (!enabled(currentVisionService()))
          throw new AppError(503, '视觉模型尚未配置，暂时无法看图解题。', 'VISION_NOT_CONFIGURED');
      } catch (error) {
        next(error);
        return;
      }
      upload(req, res, (error) => {
        if (error)
          next(
            new AppError(
              error.code === 'LIMIT_FILE_SIZE' ? 413 : 422,
              '请上传一张不超过 10MB 的 PNG、JPG 或 WebP 图片。',
            ),
          );
        else next();
      });
    },
    async (req, res) => {
      const courseId = String(req.params.courseId);
      if (!req.file) throw new AppError(422, '请选择一张习题图片。');
      if (req.body.question !== undefined && typeof req.body.question !== 'string')
        throw new AppError(422, '问题格式无效。');
      const question = req.body.question?.trim() || '请解答图片中的习题，写出思路和关键步骤。';
      if (question.length > 1500) throw new AppError(422, '问题不能超过 1500 字。');
      const documentId = req.body.documentId || null;
      if (documentId && !db.get('SELECT id FROM documents WHERE id=? AND course_id=?', documentId, courseId))
        throw new AppError(422, '资料不属于当前课程。');
      const page = req.body.page ? Number(req.body.page) : undefined;
      if (
        page !== undefined &&
        (!Number.isInteger(page) ||
          page < 1 ||
          page > 50 ||
          !documentId ||
          !db.get('SELECT number FROM pages WHERE document_id=? AND number=?', documentId, page))
      )
        throw new AppError(422, '所选资料页不存在。');
      const quote = req.body.quote ? quoteFor(req, JSON.parse(req.body.quote)) : undefined;
      const bytes = req.file.buffer;
      const isImage =
        bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
        (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) ||
        (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP');
      if (!isImage) throw new AppError(422, '图片格式无法读取，请使用 PNG、JPG 或 WebP。');
      const image = await loadImage(bytes).catch(() => {
        throw new AppError(422, '图片已损坏或无法读取。');
      });
      if (!image.width || !image.height || image.width * image.height > 25_000_000)
        throw new AppError(413, '图片尺寸过大，请缩小后上传。');
      const scale = Math.min(1, 2000 / Math.max(image.width, image.height));
      const canvas = createCanvas(
        Math.max(1, Math.round(image.width * scale)),
        Math.max(1, Math.round(image.height * scale)),
      );
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      const png = canvas.toBuffer('image/png');
      const answer = await runAssistantWork(req.owner, req.body.requestId, (notify) =>
        answerQuestion(
          db,
          courseId,
          question,
          quote?.documentId || documentId,
          quote?.page || page,
          quote,
          { data: png, mime: 'image/png' },
          notify,
        ),
      );
      requireCourse(db, req.owner, courseId);
      const imageId = id(),
        userId = id(),
        messageId = id(),
        timestamp = now();
      const directory = path.join(config.dataDir, 'chat-images');
      fs.mkdirSync(directory, { recursive: true });
      const filename = `${imageId}.png`,
        filePath = path.join(directory, filename);
      const restored = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
      const name = path
        .basename(restored.includes('\uFFFD') ? req.file.originalname : restored)
        .slice(0, 160);
      let saved = false;
      try {
        fs.writeFileSync(filePath, png);
        db.transaction(() => {
          db.run(
            'INSERT INTO messages(id,course_id,document_id,role,text,created_at) VALUES(?,?,?,?,?,?)',
            userId,
            courseId,
            documentId,
            'user',
            quote ? `划线 · 第 ${quote.page} 页：“${quote.text}”\n${question}` : question,
            timestamp,
          );
          db.run(
            'INSERT INTO chat_images(id,message_id,owner,course_id,filename,name) VALUES(?,?,?,?,?,?)',
            imageId,
            userId,
            req.owner,
            courseId,
            filename,
            name,
          );
          db.run(
            'INSERT INTO messages(id,course_id,document_id,role,text,sections,sources,mode,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
            messageId,
            courseId,
            documentId,
            'assistant',
            answer.sections.map((section) => section.text).join('\n\n'),
            JSON.stringify(answer.sections),
            JSON.stringify(answer.sources),
            answer.mode,
            timestamp,
          );
          db.run(
            'INSERT INTO message_tools(message_id,events) VALUES(?,?)',
            messageId,
            JSON.stringify(answer.tools),
          );
        });
        saved = true;
      } finally {
        if (!saved && fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
      res.json({ id: messageId, courseId, documentId, role: 'assistant', createdAt: timestamp, ...answer });
    },
  );
}
