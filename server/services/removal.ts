import fs from 'node:fs';
import path from 'node:path';
import type { Store } from '../db.ts';
import { config } from '../config.ts';
import { AppError } from '../domain.ts';

const BUSY = ['parsing', 'indexing'];

function assertIdle(status: string) {
  if (BUSY.includes(status)) throw new AppError(409, '资料正在整理中，等处理完再删除吧。');
}

/**
 * Removes a document and everything derived from it (pages, chunks, knowledge
 * points, quizzes, highlights). Stuck notes and chat messages written by the
 * user are kept but detached from the document. Must run inside a transaction.
 * Returns files to unlink once the transaction has committed.
 */
function removeDocumentRows(db: Store, documentId: string) {
  const doc = db.get<{ filename: string; status: string }>(
    'SELECT filename,status FROM documents WHERE id=?',
    documentId,
  );
  if (!doc) return [];
  assertIdle(doc.status);
  const points = 'SELECT id FROM points WHERE document_id=?';
  db.run(`DELETE FROM attempts WHERE quiz_id IN (SELECT id FROM quizzes WHERE point_id IN (${points}))`, documentId);
  db.run(`DELETE FROM quizzes WHERE point_id IN (${points})`, documentId);
  db.run(`UPDATE stuck SET point_id=NULL WHERE point_id IN (${points})`, documentId);
  db.run('UPDATE stuck SET document_id=NULL,page=NULL WHERE document_id=?', documentId);
  db.run('UPDATE messages SET document_id=NULL WHERE document_id=?', documentId);
  db.run('DELETE FROM points WHERE document_id=?', documentId);
  db.run('DELETE FROM chunks WHERE document_id=?', documentId);
  db.run('DELETE FROM pages WHERE document_id=?', documentId);
  db.run('DELETE FROM highlights WHERE document_id=?', documentId);
  db.run('DELETE FROM reading_positions WHERE document_id=?', documentId);
  db.run('DELETE FROM documents WHERE id=?', documentId);
  return [path.join(config.dataDir, 'uploads', doc.filename), path.join(config.dataDir, 'pages', documentId)];
}

function unlink(paths: string[]) {
  for (const target of paths) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
    } catch (error) {
      console.error('[removal]', error instanceof Error ? error.message : 'unlink failed');
    }
  }
}

export function deleteDocument(db: Store, documentId: string) {
  unlink(db.transaction(() => removeDocumentRows(db, documentId)));
}

export function deleteCourse(db: Store, owner: string, courseId: string) {
  const files = db.transaction(() => {
    const docs = db.all<{ id: string; status: string }>('SELECT id,status FROM documents WHERE course_id=?', courseId);
    for (const doc of docs) assertIdle(doc.status);
    const files = docs.flatMap((doc) => removeDocumentRows(db, doc.id));
    db.run(
      'DELETE FROM attempts WHERE quiz_id IN (SELECT id FROM quizzes WHERE course_id=?)',
      courseId,
    );
    db.run('DELETE FROM quizzes WHERE course_id=?', courseId);
    db.run('DELETE FROM stuck WHERE course_id=?', courseId);
    db.run('DELETE FROM messages WHERE course_id=?', courseId);
    db.run('DELETE FROM points WHERE course_id=?', courseId);
    db.run('DELETE FROM chunks WHERE course_id=?', courseId);
    // keep the activity heatmap, just forget which course it belonged to
    db.run('UPDATE events SET course_id=NULL WHERE course_id=?', courseId);
    db.run(
      "DELETE FROM idempotency WHERE owner=? AND operation='create-course' AND response LIKE ?",
      owner,
      `%"id":"${courseId}"%`,
    );
    db.run('DELETE FROM courses WHERE id=? AND owner=?', courseId, owner);
    return files;
  });
  unlink(files);
}
