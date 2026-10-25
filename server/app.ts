import express, { type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import type { Profile, QuizResult, StuckPoint, ReadingQuote } from '../shared/types.ts';
import type { Store } from './db.ts';
import { config, enabled } from './config.ts';
import {
  AppError,
  dateKey,
  defaultProfile,
  id,
  listCourses,
  mapPoint,
  now,
  requireCourse,
  reviewTransition,
  validateTimezone,
  sourceRows,
  nextCourseSlot,
  pointForPage,
  flagStuckPoint,
  linkLegacyStuckNotes,
} from './domain.ts';
import { courseSchema, validate } from './contracts.ts';
import { PPTX_MIME, createDocumentQueue, documentRecord } from './services/documents.ts';
import { answerQuestion, generateQuiz } from './services/learning.ts';
import { embeddings } from './services/ai.ts';
import {
  currentChatService,
  withOwnerModel,
  settingsSummary,
  encryptSecret,
  normalizeBase,
  ownerService,
  modelFetch,
} from './services/model-settings.ts';
import { repairLegacyTitles } from './services/structure.ts';
import { deleteCourse, deleteDocument } from './services/removal.ts';

declare global {
  namespace Express {
    interface Request {
      owner: string;
    }
  }
}
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function text(value: unknown, max = 2000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new AppError(422, `请填写 1–${max} 字的有效内容。`);
  return value.trim();
}
function requestId(value: unknown) {
  if (typeof value !== 'string' || !uuidPattern.test(value))
    throw new AppError(422, '请求标识无效，请重新操作。');
  return value;
}
function positivePage(value: unknown) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 50) throw new AppError(422, '页码不合法。');
  return number;
}

export function createApp(db: Store, options: { processDocuments?: boolean; party?: boolean } = {}) {
  repairLegacyTitles(db);
  linkLegacyStuckNotes(db);
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);
  app.use(express.json({ limit: '96kb' }));
  const queue = createDocumentQueue(db);
  if (options.processDocuments !== false) queue.resume();
  const uploadDir = path.join(config.dataDir, 'uploads');
  fs.mkdirSync(uploadDir, { recursive: true });
  const upload = multer({ dest: uploadDir, limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 4 } });
  app.get('/api/health', (_req, res) => res.json({ ok: true, version: '0.2.0' }));
  app.use('/api', (req, res, next) => {
    const origin = req.get('Origin');
    if (origin && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      try {
        const allowed = config.publicOrigin
          ? new URL(config.publicOrigin).origin
          : `${req.protocol}://${req.get('host')}`;
        if (new URL(origin).origin !== allowed) throw new Error('origin');
      } catch {
        next(new AppError(403, '请求来源不匹配，请从站点页面重新操作。'));
        return;
      }
    }
    const cookie = req.headers.cookie?.match(/(?:^|;\s*)zhiyu_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    let owner = cookie;
    if (!owner || !db.get('SELECT id FROM profiles WHERE id=?', owner)) {
      owner = randomBytes(32).toString('hex');
      db.run(
        'INSERT INTO profiles(id,settings,created_at) VALUES(?,?,?)',
        owner,
        JSON.stringify(defaultProfile),
        now(),
      );
      res.cookie('zhiyu_session', owner, {
        httpOnly: true,
        sameSite: 'lax',
        secure: req.secure || config.publicOrigin.startsWith('https://'),
        maxAge: 365 * 86400000,
        path: '/',
      });
    }
    req.owner = owner;
    res.setHeader('Cache-Control', 'no-store');
    withOwnerModel(db, owner, next);
  });
  const rate = new Map<string, { count: number; until: number }>();
  function modelLimit(req: Request, _res: Response, next: NextFunction) {
    const key = req.ip || req.owner,
      current = rate.get(key),
      time = Date.now();
    if (!current || current.until < time) rate.set(key, { count: 1, until: time + 60000 });
    else if (++current.count > 20) {
      next(new AppError(429, '操作有些频繁，请稍等一分钟再试。'));
      return;
    }
    if (rate.size > 2000) for (const [entry, record] of rate) if (record.until < time) rate.delete(entry);
    next();
  }
  app.get('/api/bootstrap', (req, res) =>
    res.json({
      courses: listCourses(db, req.owner),
      // older profiles predate some settings; fill them from the defaults
      profile: {
        ...defaultProfile,
        ...JSON.parse(db.get<{ settings: string }>('SELECT settings FROM profiles WHERE id=?', req.owner)!.settings),
      },
      capabilities: {
        chat: enabled(currentChatService()),
        embeddings: enabled(config.embedding),
        ocr: config.ocr,
        vision: enabled(config.vision),
        party: options.party !== false,
        partyUrl: config.partyUrl,
      },
    }),
  );
  app.get('/api/model-settings', (req, res) => res.json(settingsSummary(db, req.owner)));
  app.put('/api/model-settings', (req, res) => {
    const { mode, base, model, key } = req.body;
    if (!['site', 'personal'].includes(mode)) throw new AppError(422, '请选择站点默认或个人 API。');
    const old = db.get<{ base: string; model: string; secret: string }>(
      'SELECT * FROM model_settings WHERE owner=?',
      req.owner,
    );
    const normalized = base
      ? normalizeBase(base, config.publicOrigin || `${req.protocol}://${req.get('host')}`)
      : old?.base || '';
    const modelName = typeof model === 'string' ? model.trim() : old?.model || '';
    if (modelName.length > 160 || /[\r\n]/.test(modelName)) throw new AppError(422, '模型名称无效。');
    if (key != null && (typeof key !== 'string' || key.length > 4096 || /[\r\n]/.test(key)))
      throw new AppError(422, 'API Key 格式无效。');
    // A replacement address must also have a replacement key; do not forward a saved key to another service.
    if (old?.secret && normalized !== old.base && !key?.trim())
      throw new AppError(422, '更换服务地址时，请重新填写对应的 API Key。');
    const secret = key?.trim() ? encryptSecret(key.trim()) : old?.secret || '';
    if (mode === 'personal' && (!normalized || !modelName || !secret))
      throw new AppError(422, '请填写服务地址、模型名称和 API Key。');
    db.run(
      'INSERT INTO model_settings(owner,mode,base,model,secret) VALUES(?,?,?,?,?) ON CONFLICT(owner) DO UPDATE SET mode=excluded.mode,base=excluded.base,model=excluded.model,secret=excluded.secret',
      req.owner,
      mode,
      normalized,
      modelName,
      secret,
    );
    res.json(settingsSummary(db, req.owner));
  });
  app.delete('/api/model-settings', (req, res) => {
    db.run('DELETE FROM model_settings WHERE owner=?', req.owner);
    res.json(settingsSummary(db, req.owner));
  });
  app.post('/api/model-settings/test', modelLimit, async (req, res) => {
    const service = ownerService(db, req.owner);
    if (!enabled(service)) throw new AppError(422, '请先保存完整的模型配置。');
    try {
      const response = await modelFetch(service, 'models', {
        method: 'GET',
        headers: { Authorization: `Bearer ${service.key}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new AppError(502, `服务返回 ${response.status}，请检查地址和 Key。`);
      const result = (await response.json()) as { data?: { id: string }[] };
      const models = Array.isArray(result.data)
        ? result.data
            .filter((item) => typeof item.id === 'string')
            .map((item) => item.id.slice(0, 160))
            .slice(0, 100)
        : [];
      res.json({ ok: true, models, modelListed: models.includes(service.model) });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(502, '暂时无法连接，请检查 API 地址、证书与 Key。');
    }
  });
  app.get('/api/courses', (req, res) => res.json(listCourses(db, req.owner)));
  app.post('/api/courses', (req, res) => {
    validate<{
      name: string;
      shape: string;
      palette: string;
      examDate?: string | null;
      requestId: string;
      seaId?: number;
      slotId?: number;
    }>(courseSchema, req.body);
    const body = req.body;
    const name = text(body.name, 30);
    const course = db.transaction(() => {
      const saved = db.get<{ response: string }>(
        'SELECT response FROM idempotency WHERE owner=? AND operation=? AND request_id=?',
        req.owner,
        'create-course',
        body.requestId,
      );
      if (saved) {
        const previous = JSON.parse(saved.response);
        return listCourses(db, req.owner).find((course) => course.id === previous.id) || previous;
      }
      let slot = nextCourseSlot(db, req.owner);
      if (body.seaId !== undefined && body.slotId !== undefined) {
        const taken = db.get(
          'SELECT id FROM courses WHERE owner=? AND sea_id=? AND slot_id=?',
          req.owner,
          body.seaId,
          body.slotId,
        );
        if (taken) throw new AppError(409, '这块地已经有课程了，换一块空地吧。');
        slot = { seaId: body.seaId, slotId: body.slotId };
      }
      const courseId = id();
      db.run(
        'INSERT INTO courses(id,owner,name,shape,palette,exam_date,sea_id,slot_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
        courseId,
        req.owner,
        name,
        body.shape,
        body.palette,
        body.examDate || null,
        slot.seaId,
        slot.slotId,
        now(),
      );
      const result = listCourses(db, req.owner).find((course) => course.id === courseId)!;
      db.run(
        'INSERT INTO idempotency(owner,operation,request_id,response) VALUES(?,?,?,?)',
        req.owner,
        'create-course',
        body.requestId,
        JSON.stringify(result),
      );
      return result;
    });
    res.status(201).json(course);
  });
  app.patch('/api/courses/:courseId', (req, res) => {
    const courseId = String(req.params.courseId);
    requireCourse(db, req.owner, courseId);
    if (req.body.name !== undefined)
      db.run('UPDATE courses SET name=? WHERE id=?', text(req.body.name, 30), courseId);
    if (req.body.examDate !== undefined) {
      const exam = req.body.examDate;
      if (
        exam !== null &&
        !(
          typeof exam === 'string' &&
          /^\d{4}-\d{2}-\d{2}$/.test(exam) &&
          !Number.isNaN(new Date(exam).getTime()) &&
          new Date(exam).toISOString().slice(0, 10) === exam
        )
      )
        throw new AppError(422, '考试日期无效。');
      db.run('UPDATE courses SET exam_date=? WHERE id=?', exam, courseId);
    }
    res.json(listCourses(db, req.owner).find((course) => course.id === courseId));
  });
  app.delete('/api/courses/:courseId', (req, res) => {
    const courseId = String(req.params.courseId);
    requireCourse(db, req.owner, courseId);
    deleteCourse(db, req.owner, courseId);
    res.json({ ok: true });
  });
  app.get('/api/courses/:courseId/detail', (req, res) => {
    const courseId = String(req.params.courseId);
    requireCourse(db, req.owner, courseId);
    res.json({
      course: listCourses(db, req.owner).find((course) => course.id === courseId),
      documents: db
        .all('SELECT * FROM documents WHERE course_id=? ORDER BY created_at DESC', courseId)
        .map(documentRecord),
      points: db
        .all('SELECT * FROM points WHERE course_id=? ORDER BY group_index,rowid', courseId)
        .map(mapPoint),
      stuck: db
        .all<Record<string, unknown>>(
          'SELECT * FROM stuck WHERE course_id=? ORDER BY created_at DESC',
          courseId,
        )
        .map((row) => ({
          id: row.id,
          courseId,
          pointId: row.point_id,
          documentId: row.document_id,
          page: row.page,
          text: row.text,
          resolved: Boolean(row.resolved),
          createdAt: row.created_at,
        })),
    });
  });
  app.post('/api/courses/:courseId/documents', modelLimit, (req, res, next) => {
    try {
      requireCourse(db, req.owner, String(req.params.courseId));
    } catch (error) {
      next(error);
      return;
    }
    upload.single('file')(req, res, (error) => {
      if (error) {
        next(error);
        return;
      }
      try {
        if (!req.file) throw new AppError(422, '请选择一份资料。');
        const courseId = String(req.params.courseId),
          file = req.file;
        const bytes = fs.readFileSync(file.path);
        const ext = path.extname(file.originalname).toLowerCase();
        let mime: string;
        if (bytes.subarray(0, 5).toString() === '%PDF-') mime = 'application/pdf';
        else if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
          mime = 'image/png';
        else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) mime = 'image/jpeg';
        else if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP')
          mime = 'image/webp';
        else if (['.txt', '.md', '.markdown'].includes(ext) && !bytes.includes(0)) mime = 'text/plain';
        else if (ext === '.pptx' && bytes.length > 4 && bytes.readUInt32LE(0) === 0x04034b50) mime = PPTX_MIME;
        else if (ext === '.ppt')
          throw new AppError(422, '旧版 .ppt 暂不支持，请在 PowerPoint 里另存为 .pptx 或导出 PDF。');
        else throw new AppError(422, '请上传 PDF、PPTX、PNG、JPG、WebP 或 UTF-8 文本。');
        const hash = createHash('sha256').update(bytes).digest('hex');
        const existing = db.get(
          'SELECT * FROM documents WHERE owner=? AND course_id=? AND hash=?',
          req.owner,
          courseId,
          hash,
        );
        if (existing) {
          fs.unlinkSync(file.path);
          res.json(documentRecord(existing));
          return;
        }
        const count = db.get<{ count: number }>(
          'SELECT COUNT(*) AS count FROM documents WHERE owner=?',
          req.owner,
        )!.count;
        if (count >= 60) throw new AppError(422, '当前会话最多保存 60 份资料。');
        const documentId = id();
        // Multer decodes multipart filenames as latin1; restore UTF-8 only when it is a valid round-trip.
        const restored = Buffer.from(file.originalname, 'latin1').toString('utf8');
        const name = path.basename(restored.includes('\uFFFD') ? file.originalname : restored).slice(0, 160);
        db.run(
          'INSERT INTO documents(id,owner,course_id,name,mime,filename,hash,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
          documentId,
          req.owner,
          courseId,
          name,
          mime,
          file.filename,
          hash,
          'uploaded',
          now(),
        );
        res.status(202).json(documentRecord(db.get('SELECT * FROM documents WHERE id=?', documentId)!));
        if (options.processDocuments !== false) queue.enqueue(documentId);
      } catch (error) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        next(error);
      }
    });
  });
  function documentFor(req: Request) {
    const doc = db.get<Record<string, unknown>>(
      'SELECT * FROM documents WHERE id=? AND owner=?',
      String(req.params.documentId),
      req.owner,
    );
    if (!doc) throw new AppError(404, '资料不存在或不属于当前会话。');
    return doc;
  }
  app.get('/api/documents/:documentId', (req, res) => {
    const doc = documentFor(req);
    const pages = db
      .all<Record<string, unknown>>('SELECT * FROM pages WHERE document_id=? ORDER BY number', String(doc.id))
      .map((row) => ({
        number: row.number,
        text: row.text,
        method: row.method,
        warning: row.warning,
        hasImage: Boolean(row.has_image),
      }));
    const position = db.get<{ page: number }>(
      'SELECT page FROM reading_positions WHERE owner=? AND document_id=?',
      req.owner,
      String(doc.id),
    );
    res.json({ document: documentRecord(doc), pages, position: position?.page || 1 });
  });
  app.get('/api/documents/:documentId/pages/:page/image', (req, res) => {
    const doc = documentFor(req),
      page = positivePage(req.params.page);
    const filename = path.join(config.dataDir, 'pages', String(doc.id), `${page}.png`);
    if (!fs.existsSync(filename)) throw new AppError(404, '本页没有可用原图。');
    res.sendFile(filename);
  });
  app.get('/api/documents/:documentId/file', (req, res) => {
    const doc = documentFor(req);
    res.setHeader('Content-Type', String(doc.mime));
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(String(doc.name))}`);
    res.sendFile(path.join(uploadDir, String(doc.filename)));
  });
  app.put('/api/documents/:documentId/position', (req, res) => {
    const doc = documentFor(req),
      page = positivePage(req.body.page);
    if (page > Number(doc.page_count)) throw new AppError(422, '页码超出资料范围。');
    db.run(
      'INSERT INTO reading_positions(owner,document_id,page) VALUES(?,?,?) ON CONFLICT(owner,document_id) DO UPDATE SET page=excluded.page',
      req.owner,
      String(doc.id),
      page,
    );
    res.json({ page });
  });
  function readingQuote(req: Request, value: unknown): ReadingQuote {
    if (!value || typeof value !== 'object') throw new AppError(422, '请选择课件中的一句话。');
    const quote = value as ReadingQuote;
    const doc = db.get<{ course_id: string }>(
      'SELECT course_id FROM documents WHERE id=? AND owner=?',
      String(quote.documentId),
      req.owner,
    );
    if (
      !doc ||
      (req.params.courseId && doc.course_id !== req.params.courseId) ||
      (req.params.documentId && quote.documentId !== req.params.documentId)
    )
      throw new AppError(422, '划线内容不属于当前课件。');
    const page = positivePage(quote.page);
    const original = db.get<{ text: string }>(
      'SELECT text FROM pages WHERE document_id=? AND number=?',
      quote.documentId,
      page,
    )?.text;
    if (
      !original ||
      !Number.isInteger(quote.start) ||
      !Number.isInteger(quote.end) ||
      quote.start < 0 ||
      quote.end <= quote.start ||
      quote.end > original.length ||
      quote.end - quote.start > 1200 ||
      original.slice(quote.start, quote.end) !== quote.text ||
      !quote.text.trim()
    )
      throw new AppError(422, '划线位置与课件原文不一致，请重新选择。');
    return { documentId: quote.documentId, page, start: quote.start, end: quote.end, text: quote.text };
  }
  app.get('/api/documents/:documentId/highlights', (req, res) => {
    const doc = documentFor(req);
    res.json(
      db
        .all<Record<string, unknown>>(
          'SELECT * FROM highlights WHERE document_id=? AND owner=? ORDER BY page,start_offset',
          String(doc.id),
          req.owner,
        )
        .map((row) => ({
          id: row.id,
          documentId: row.document_id,
          page: row.page,
          start: row.start_offset,
          end: row.end_offset,
          text: row.text,
          createdAt: row.created_at,
        })),
    );
  });
  app.post('/api/documents/:documentId/highlights', (req, res) => {
    const quote = readingQuote(req, req.body);
    const count = db.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM highlights WHERE owner=? AND document_id=?',
      req.owner,
      quote.documentId,
    )!.count;
    if (count >= 500) throw new AppError(422, '这份课件已有很多划线，请先删除部分标记。');
    // Overlapping or touching marks on the same page are merged into one span,
    // so a mark never hides inside another one.
    const merged = db.transaction(() => {
      const touching = db.all<{ start_offset: number; end_offset: number }>(
        'SELECT start_offset,end_offset FROM highlights WHERE owner=? AND document_id=? AND page=? AND start_offset<=? AND end_offset>=?',
        req.owner,
        quote.documentId,
        quote.page,
        quote.end,
        quote.start,
      );
      // already fully marked: keep the existing mark as is
      const containing = db.get<{
        id: string;
        start_offset: number;
        end_offset: number;
        text: string;
        created_at: string;
      }>(
        'SELECT * FROM highlights WHERE owner=? AND document_id=? AND page=? AND start_offset<=? AND end_offset>=?',
        req.owner,
        quote.documentId,
        quote.page,
        quote.start,
        quote.end,
      );
      if (containing && touching.length === 1)
        return {
          ...quote,
          start: containing.start_offset,
          end: containing.end_offset,
          text: containing.text,
          id: containing.id,
          createdAt: containing.created_at,
        };
      const start = Math.min(quote.start, ...touching.map((row) => row.start_offset)),
        end = Math.max(quote.end, ...touching.map((row) => row.end_offset));
      const original = db.get<{ text: string }>(
        'SELECT text FROM pages WHERE document_id=? AND number=?',
        quote.documentId,
        quote.page,
      )!.text;
      db.run(
        'DELETE FROM highlights WHERE owner=? AND document_id=? AND page=? AND start_offset<=? AND end_offset>=?',
        req.owner,
        quote.documentId,
        quote.page,
        quote.end,
        quote.start,
      );
      const markId = id(),
        createdAt = now();
      const text = original.slice(start, end);
      db.run(
        'INSERT INTO highlights(id,owner,document_id,page,start_offset,end_offset,text,created_at) VALUES(?,?,?,?,?,?,?,?)',
        markId,
        req.owner,
        quote.documentId,
        quote.page,
        start,
        end,
        text,
        createdAt,
      );
      return { ...quote, start, end, text, id: markId, createdAt };
    });
    res.status(201).json(merged);
  });
  // Remove every mark that overlaps the selected range (selecting a few
  // characters inside a mark removes the whole mark).
  app.delete('/api/documents/:documentId/highlights', (req, res) => {
    const doc = documentFor(req);
    const page = positivePage(Number(req.query.page)),
      start = Number(req.query.start),
      end = Number(req.query.end);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start)
      throw new AppError(422, '请选择要取消的划线。');
    const removed = db.run(
      'DELETE FROM highlights WHERE owner=? AND document_id=? AND page=? AND start_offset<? AND end_offset>?',
      req.owner,
      String(doc.id),
      page,
      end,
      start,
    );
    res.json({ ok: true, removed: Number(removed.changes) });
  });
  app.delete('/api/documents/:documentId/highlights/:highlightId', (req, res) => {
    documentFor(req);
    db.run(
      'DELETE FROM highlights WHERE id=? AND owner=? AND document_id=?',
      String(req.params.highlightId),
      req.owner,
      String(req.params.documentId),
    );
    res.json({ ok: true });
  });
  app.delete('/api/documents/:documentId', (req, res) => {
    const doc = documentFor(req);
    deleteDocument(db, String(doc.id));
    res.json({ ok: true });
  });
  // Re-extract text with the current cleaning rules; learning records are kept.
  app.post('/api/documents/:documentId/reprocess', modelLimit, (req, res) => {
    const doc = documentFor(req);
    if (['uploaded', 'parsing', 'indexing'].includes(String(doc.status)))
      throw new AppError(409, '这份资料正在整理中。');
    db.run("UPDATE documents SET status='uploaded',error=NULL,progress=0 WHERE id=?", String(doc.id));
    if (options.processDocuments !== false) queue.enqueue(String(doc.id));
    res.status(202).json({ ok: true });
  });
  app.post('/api/documents/:documentId/retry', modelLimit, (req, res) => {
    const doc = documentFor(req);
    if (!['failed', 'partial'].includes(String(doc.status)))
      throw new AppError(409, '这份资料正在处理或已可用。');
    if (
      db.get(
        'SELECT q.id FROM quizzes q JOIN points p ON p.id=q.point_id WHERE p.document_id=? LIMIT 1',
        String(doc.id),
      ) ||
      db.get(
        'SELECT id FROM stuck WHERE document_id=? OR point_id IN (SELECT id FROM points WHERE document_id=?) LIMIT 1',
        String(doc.id),
        String(doc.id),
      )
    )
      throw new AppError(409, '这份资料已有学习记录，请保留原资料并上传新的版本。');
    db.run("UPDATE documents SET status='uploaded',error=NULL,progress=0 WHERE id=?", String(doc.id));
    queue.enqueue(String(doc.id));
    res.json({ ok: true });
  });
  app.post('/api/documents/:documentId/reindex', modelLimit, async (req, res) => {
    const doc = documentFor(req);
    if (!enabled(config.embedding)) throw new AppError(503, '向量服务尚未配置，当前仍可使用原文关键词检索。');
    const chunks = db.all<{ id: string; text: string }>(
      'SELECT id,text FROM chunks WHERE document_id=? ORDER BY page,rowid',
      String(doc.id),
    );
    if (!chunks.length) throw new AppError(422, '这份资料还没有可索引的文字。');
    const vectors: number[][] = [];
    for (let i = 0; i < chunks.length; i += 24)
      vectors.push(...(await embeddings(chunks.slice(i, i + 24).map((chunk) => chunk.text)))!);
    db.transaction(() => {
      chunks.forEach((chunk, index) =>
        db.run('UPDATE chunks SET embedding=? WHERE id=?', JSON.stringify(vectors[index]), chunk.id),
      );
    });
    res.json({ ok: true, indexedChunks: chunks.length });
  });
  app.patch('/api/points/:pointId', (req, res) => {
    const point = db.get<{ course_id: string }>(
      'SELECT course_id FROM points WHERE id=?',
      String(req.params.pointId),
    );
    if (!point) throw new AppError(404, '知识点不存在。');
    requireCourse(db, req.owner, point.course_id);
    if (req.body.title !== undefined)
      db.run('UPDATE points SET title=? WHERE id=?', text(req.body.title, 80), String(req.params.pointId));
    if (req.body.unfamiliar !== undefined) {
      if (typeof req.body.unfamiliar !== 'boolean') throw new AppError(422, '标记状态无效。');
      db.run(
        'UPDATE points SET unfamiliar=? WHERE id=?',
        req.body.unfamiliar ? 1 : 0,
        String(req.params.pointId),
      );
    }
    res.json({ ok: true });
  });
  app.post('/api/courses/:courseId/stuck', (req, res) => {
    const courseId = String(req.params.courseId);
    requireCourse(db, req.owner, courseId);
    const { pointId, documentId } = req.body;
    if (pointId && !db.get('SELECT id FROM points WHERE id=? AND course_id=?', pointId, courseId))
      throw new AppError(422, '知识点不属于这门课程。');
    if (documentId && !db.get('SELECT id FROM documents WHERE id=? AND course_id=?', documentId, courseId))
      throw new AppError(422, '资料不属于这门课程。');
    const page = req.body.page == null ? null : positivePage(req.body.page);
    if (
      page &&
      (!documentId || !db.get('SELECT number FROM pages WHERE document_id=? AND number=?', documentId, page))
    )
      throw new AppError(422, '所选资料页不存在。');
    // notes written while reading attach to the point that covers the page
    const linked = pointId || (documentId && page ? pointForPage(db, documentId, page) : null);
    const result: StuckPoint = {
      id: id(),
      courseId,
      pointId: linked || null,
      documentId: documentId || null,
      page,
      text: text(req.body.text, 1000),
      resolved: false,
      createdAt: now(),
    };
    db.run(
      'INSERT INTO stuck(id,course_id,point_id,document_id,page,text,created_at) VALUES(?,?,?,?,?,?,?)',
      result.id,
      courseId,
      result.pointId,
      result.documentId,
      page,
      result.text,
      result.createdAt,
    );
    flagStuckPoint(db, result.pointId);
    res.status(201).json(result);
  });
  app.patch('/api/stuck/:stuckId', (req, res) => {
    const stuck = db.get<{ course_id: string }>(
      'SELECT course_id FROM stuck WHERE id=?',
      String(req.params.stuckId),
    );
    if (!stuck) throw new AppError(404, '卡点不存在。');
    requireCourse(db, req.owner, stuck.course_id);
    if (typeof req.body.resolved !== 'boolean') throw new AppError(422, '卡点状态无效。');
    db.run('UPDATE stuck SET resolved=? WHERE id=?', req.body.resolved ? 1 : 0, String(req.params.stuckId));
    res.json({ ok: true });
  });
  app.get('/api/courses/:courseId/messages', (req, res) => {
    const courseId = String(req.params.courseId);
    requireCourse(db, req.owner, courseId);
    res.json(
      db
        .all<Record<string, unknown>>(
          'SELECT * FROM (SELECT rowid,* FROM messages WHERE course_id=? ORDER BY rowid DESC LIMIT 100) ORDER BY rowid',
          courseId,
        )
        .map((row) => ({
          id: row.id,
          courseId,
          documentId: row.document_id,
          role: row.role,
          text: row.text,
          sections: JSON.parse(String(row.sections)),
          sources: JSON.parse(String(row.sources)),
          mode: row.mode,
          createdAt: row.created_at,
        })),
    );
  });
  app.post('/api/courses/:courseId/ask', modelLimit, async (req, res) => {
    const courseId = String(req.params.courseId);
    requireCourse(db, req.owner, courseId);
    const question = text(req.body.question, 1500);
    const documentId = req.body.documentId || null,
      page = req.body.page == null ? undefined : positivePage(req.body.page);
    if (documentId && !db.get('SELECT id FROM documents WHERE id=? AND course_id=?', documentId, courseId))
      throw new AppError(422, '资料不属于当前课程。');
    const quote = req.body.quote ? readingQuote(req, req.body.quote) : undefined;
    const answer = await answerQuestion(
      db,
      courseId,
      question,
      quote?.documentId || documentId,
      quote?.page || page,
      quote,
    );
    const messageId = id(),
      timestamp = now();
    db.transaction(() => {
      db.run(
        'INSERT INTO messages(id,course_id,document_id,role,text,created_at) VALUES(?,?,?,?,?,?)',
        id(),
        courseId,
        documentId,
        'user',
        quote ? `划线 · 第 ${quote.page} 页：“${quote.text}”\n${question}` : question,
        timestamp,
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
    });
    res.json({
      id: messageId,
      courseId,
      documentId,
      role: 'assistant',
      text: answer.sections.map((section) => section.text).join('\n\n'),
      createdAt: timestamp,
      ...answer,
    });
  });
  app.post('/api/courses/:courseId/reading-complete', (req, res) => {
    const courseId = String(req.params.courseId);
    requireCourse(db, req.owner, courseId);
    const sessionId = requestId(req.body.sessionId);
    const userMessages = db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM messages WHERE course_id=? AND role='user'",
      courseId,
    )!.count;
    if (!userMessages) throw new AppError(422, '先完成一次提问或复习，再记录这次共读。');
    // A reading event is tied to the last assistant message, not a client-provided fresh UUID.
    const message = db.get<{ id: string }>(
      "SELECT id FROM messages WHERE course_id=? AND role='assistant' ORDER BY rowid DESC LIMIT 1",
      courseId,
    )!;
    db.run(
      'INSERT OR IGNORE INTO events(id,owner,course_id,type,title,source_id,created_at) VALUES(?,?,?,?,?,?,?)',
      sessionId,
      req.owner,
      courseId,
      'reading',
      '完成课件共读',
      message.id,
      now(),
    );
    res.json({ ok: true });
  });
  app.post('/api/courses/:courseId/quiz', modelLimit, async (req, res) => {
    const courseId = String(req.params.courseId);
    requireCourse(db, req.owner, courseId);
    res.json(await generateQuiz(db, courseId, text(req.body.pointId, 80)));
  });
  app.post('/api/quizzes/:quizId/submit', (req, res) => {
    const quizId = String(req.params.quizId);
    const quiz = db.get<{
      id: string;
      course_id: string;
      point_id: string;
      prompt: string;
      options: string;
      correct_option_id: string;
      explanation: string;
    }>('SELECT * FROM quizzes WHERE id=?', quizId);
    if (!quiz) throw new AppError(404, '这道题不存在。');
    const course = requireCourse(db, req.owner, quiz.course_id);
    const submissionId = requestId(req.body.requestId);
    if (typeof req.body.hinted !== 'boolean') throw new AppError(422, '提示使用状态无效。');
    const optionId = text(req.body.optionId, 1);
    if (!(JSON.parse(quiz.options) as { id: string }[]).some((option) => option.id === optionId))
      throw new AppError(422, '请选择有效选项。');
    const result = db.transaction(() => {
      const existing = db.get<{ result: string }>(
        'SELECT result FROM attempts WHERE quiz_id=? AND owner=?',
        quizId,
        req.owner,
      );
      if (existing) return JSON.parse(existing.result) as QuizResult;
      const point = db.get<Record<string, unknown>>('SELECT * FROM points WHERE id=?', quiz.point_id)!;
      const prior = db.get<{ prompt: string }>(
        'SELECT q.prompt FROM attempts a JOIN quizzes q ON q.id=a.quiz_id WHERE q.point_id=? ORDER BY a.created_at DESC,a.rowid DESC LIMIT 1',
        quiz.point_id,
      );
      const correct = optionId === quiz.correct_option_id;
      const transition = reviewTransition(
        Number(point.streak),
        correct,
        req.body.hinted || prior?.prompt === quiz.prompt,
        course.exam_date,
      );
      const timestamp = now(),
        eventId = id();
      const saved: QuizResult = {
        quizId,
        correct,
        correctOptionId: quiz.correct_option_id,
        explanation: quiz.explanation,
        before: point.state as QuizResult['before'],
        after: transition.state,
        nextReviewAt: transition.nextReviewAt,
        eventId,
      };
      db.run(
        'INSERT INTO attempts(id,quiz_id,owner,option_id,correct,hinted,result,created_at) VALUES(?,?,?,?,?,?,?,?)',
        submissionId,
        quizId,
        req.owner,
        optionId,
        correct ? 1 : 0,
        req.body.hinted ? 1 : 0,
        JSON.stringify(saved),
        timestamp,
      );
      db.run(
        'UPDATE points SET state=?,streak=?,next_review_at=?,last_reviewed_at=? WHERE id=?',
        transition.state,
        transition.streak,
        transition.nextReviewAt,
        timestamp,
        quiz.point_id,
      );
      db.run(
        'INSERT INTO events(id,owner,course_id,type,title,source_id,created_at) VALUES(?,?,?,?,?,?,?)',
        eventId,
        req.owner,
        quiz.course_id,
        'review',
        String(point.title),
        quizId,
        timestamp,
      );
      res.setHeader('Cache-Control', 'no-store');
      return saved;
    });
    res.json(result);
  });
  app.get('/api/reviews', (req, res) => {
    const rows = db.all<Record<string, unknown>>(
      `SELECT p.*,c.name AS course_name,
      EXISTS(SELECT 1 FROM stuck s WHERE s.point_id=p.id AND s.resolved=0) AS has_stuck
      FROM points p JOIN courses c ON c.id=p.course_id WHERE c.owner=?
      ORDER BY has_stuck DESC,CASE WHEN p.next_review_at<=? THEN 0 WHEN p.state='unexplored' THEN 2 ELSE 1 END,p.next_review_at,p.rowid`,
      req.owner,
      now(),
    );
    res.json(
      rows.map((row) => ({
        point: mapPoint(row),
        courseName: row.course_name,
        due: Boolean(row.next_review_at && String(row.next_review_at) <= now()),
        stuck: Boolean(row.has_stuck),
        source: sourceRows(db, String(row.course_id), JSON.parse(String(row.source_ids)))[0],
        reason: row.has_stuck
          ? '有一个还没解决的卡点'
          : row.next_review_at && String(row.next_review_at) <= now()
            ? '到了回访这个知识点的时间'
            : row.state === 'unexplored'
              ? '可以从这里开始探索'
              : '下一次复习已安排',
      })),
    );
  });
  app.post('/api/points/:pointId/postpone', (req, res) => {
    const point = db.get<{ course_id: string }>(
      'SELECT course_id FROM points WHERE id=?',
      String(req.params.pointId),
    );
    if (!point) throw new AppError(404, '知识点不存在。');
    requireCourse(db, req.owner, point.course_id);
    db.run(
      'UPDATE points SET next_review_at=? WHERE id=?',
      new Date(Date.now() + 86400000).toISOString(),
      String(req.params.pointId),
    );
    res.json({ ok: true });
  });
  app.get('/api/activity', (req, res) => {
    const profile: Profile = JSON.parse(
      db.get<{ settings: string }>('SELECT settings FROM profiles WHERE id=?', req.owner)!.settings,
    );
    const events = db.all<{ type: string; title: string; created_at: string }>(
      'SELECT type,title,created_at FROM events WHERE owner=? AND created_at>=? ORDER BY created_at',
      req.owner,
      new Date(Date.now() - 100 * 86400000).toISOString(),
    );
    const days = new Map<
      string,
      { date: string; count: number; events: { type: string; title: string }[] }
    >();
    for (const event of events) {
      const date = dateKey(event.created_at, profile.timezone);
      const day = days.get(date) || { date, count: 0, events: [] };
      day.count++;
      day.events.push({ type: event.type, title: event.title });
      days.set(date, day);
    }
    res.json([...days.values()]);
  });
  app.patch('/api/profile', (req, res) => {
    const profile: Profile = JSON.parse(
      db.get<{ settings: string }>('SELECT settings FROM profiles WHERE id=?', req.owner)!.settings,
    );
    if (req.body.timezone !== undefined) {
      if (typeof req.body.timezone !== 'string' || !validateTimezone(req.body.timezone))
        throw new AppError(422, '时区无效。');
      profile.timezone = req.body.timezone;
    }
    for (const key of ['reducedMotion', 'seaSound', 'introSeen'] as const)
      if (req.body[key] !== undefined) {
        if (typeof req.body[key] !== 'boolean') throw new AppError(422, '设置值无效。');
        profile[key] = req.body[key];
      }
    if (req.body.dailyMinutes !== undefined) {
      if (
        !Number.isInteger(req.body.dailyMinutes) ||
        req.body.dailyMinutes < 5 ||
        req.body.dailyMinutes > 120
      )
        throw new AppError(422, '每日预算为 5–120 分钟。');
      profile.dailyMinutes = req.body.dailyMinutes;
    }
    db.run('UPDATE profiles SET settings=? WHERE id=?', JSON.stringify(profile), req.owner);
    res.json(profile);
  });
  app.use('/api', (_req, _res, next) => next(new AppError(404, '这个接口不存在。')));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof multer.MulterError) {
      res.status(413).json({ error: '文件超过 20MB 或一次上传数量过多。', code: error.code });
      return;
    }
    if (error instanceof AppError) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    if (error instanceof SyntaxError) {
      res.status(400).json({ error: '请求格式无法读取，请重试。', code: 'INVALID_JSON' });
      return;
    }
    console.error('[api]', error instanceof Error ? error.message : 'unknown error');
    res.status(500).json({ error: '这次操作没有完成，请重试。', code: 'INTERNAL_ERROR' });
  });
  return { app, queue };
}
