import type { Express } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { Store } from '../db.ts';
import { config } from '../config.ts';
import { AppError, id, now, requireCourse } from '../domain.ts';
import { messageImages } from '../reader-tools.ts';
import { messageTools } from './assistant-work.ts';

export function chatMessages(db: Store, owner: string, courseId: string, sessionId: string | null = null) {
  const images = messageImages(db, owner, courseId);
  const tools = messageTools(db, courseId);
  return db
    .all<Record<string, unknown>>(
      'SELECT * FROM messages WHERE course_id=? AND session_id IS ? ORDER BY rowid',
      courseId,
      sessionId,
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
      images: images.get(String(row.id)) || [],
      tools: tools.get(String(row.id)) || [],
    }));
}
export function installReadingSessions(app: Express, db: Store) {
  app.get('/api/courses/:courseId/reading-sessions', (req, res) => {
    const courseId = String(req.params.courseId);
    requireCourse(db, req.owner, courseId);
    res.json(
      db.all(
        `SELECT s.id,s.course_id AS courseId,s.title,s.created_at AS createdAt,COUNT(m.id) AS messageCount
      FROM reading_sessions s LEFT JOIN messages m ON m.session_id=s.id WHERE s.course_id=? GROUP BY s.id ORDER BY s.rowid DESC`,
        courseId,
      ),
    );
  });
  app.get('/api/courses/:courseId/reading-sessions/:sessionId', (req, res) => {
    const courseId = String(req.params.courseId),
      sessionId = String(req.params.sessionId);
    requireCourse(db, req.owner, courseId);
    if (!db.get('SELECT id FROM reading_sessions WHERE id=? AND course_id=?', sessionId, courseId))
      throw new AppError(404, '没有找到这次共读。');
    res.json(chatMessages(db, req.owner, courseId, sessionId));
  });
  app.post('/api/courses/:courseId/reading-sessions', (req, res) => {
    const courseId = String(req.params.courseId);
    requireCourse(db, req.owner, courseId);
    const { action, lastMessageId } = req.body;
    if (!['save', 'discard'].includes(action) || typeof lastMessageId !== 'string')
      throw new AppError(422, '请选择保存会话或直接删除。');
    const result = db.transaction(() => {
      const last = db.get<{ id: string; role: string }>(
        'SELECT id,role FROM messages WHERE course_id=? AND session_id IS NULL ORDER BY rowid DESC LIMIT 1',
        courseId,
      );
      if (!last || last.id !== lastMessageId) throw new AppError(409, '当前会话已变化，请刷新聊天后重试。');
      const first = db.get<{ text: string }>(
        "SELECT text FROM messages WHERE course_id=? AND session_id IS NULL AND role='user' ORDER BY rowid LIMIT 1",
        courseId,
      );
      if (action === 'save') {
        if (!first || last.role !== 'assistant') throw new AppError(422, '请先完成一次问答，再保存共读。');
        const sessionId = id(),
          timestamp = now();
        db.run(
          'INSERT INTO reading_sessions VALUES(?,?,?,?)',
          sessionId,
          courseId,
          first.text.replace(/\s+/g, ' ').slice(0, 50),
          timestamp,
        );
        db.run(
          'UPDATE messages SET session_id=? WHERE course_id=? AND session_id IS NULL',
          sessionId,
          courseId,
        );
        db.run(
          'INSERT OR IGNORE INTO events(id,owner,course_id,type,title,source_id,created_at) VALUES(?,?,?,?,?,?,?)',
          id(),
          req.owner,
          courseId,
          'reading',
          '完成课件共读',
          last.id,
          timestamp,
        );
        return { saved: true, sessionId, files: [] as string[] };
      }
      const files = db
        .all<{ filename: string }>(
          'SELECT i.filename FROM chat_images i JOIN messages m ON m.id=i.message_id WHERE m.course_id=? AND m.session_id IS NULL',
          courseId,
        )
        .map((row) => row.filename);
      // Image and tool rows cascade with their messages. Saved sessions remain intact.
      db.run('DELETE FROM messages WHERE course_id=? AND session_id IS NULL', courseId);
      return { saved: false, sessionId: null, files };
    });
    for (const filename of result.files) {
      try {
        fs.rmSync(path.join(config.dataDir, 'chat-images', filename), { force: true });
      } catch (error) {
        console.error('[chat-image]', error instanceof Error ? error.message : 'unlink failed');
      }
    }
    res.json({ ok: true, saved: result.saved, sessionId: result.sessionId });
  });
}
