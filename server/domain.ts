import { randomUUID } from 'node:crypto';
import type { Course, KnowledgePoint, KnowledgeState, Profile } from '../shared/types.ts';
import type { Store } from './db.ts';
import { COURSES_PER_SEA, MAX_COURSES } from '../shared/ocean-layout.ts';

export function nextCourseSlot(db: Store, owner: string) {
  const occupied = new Set(
    db
      .all<{ sea_id: number; slot_id: number }>('SELECT sea_id,slot_id FROM courses WHERE owner=?', owner)
      .map((row) => `${row.sea_id}:${row.slot_id}`),
  );
  for (let index = 0; index < MAX_COURSES; index++) {
    const seaId = Math.floor(index / COURSES_PER_SEA),
      slotId = index % COURSES_PER_SEA;
    if (!occupied.has(`${seaId}:${slotId}`)) return { seaId, slotId };
  }
  throw new AppError(422, `当前最多创建 ${MAX_COURSES} 座课程岛。`);
}

export const now = () => new Date().toISOString();
export const id = () => randomUUID();
export const defaultProfile: Profile = {
  timezone: 'Asia/Singapore',
  reducedMotion: false,
  seaSound: false,
  dailyMinutes: 15,
};
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'REQUEST_ERROR',
  ) {
    super(message);
  }
}
export function requireCourse(db: Store, owner: string, courseId: string) {
  const course = db.get<{ id: string; name: string; exam_date: string | null }>(
    'SELECT * FROM courses WHERE id=? AND owner=?',
    courseId,
    owner,
  );
  if (!course) throw new AppError(404, '没有找到这座课程岛。');
  return course;
}
export function mapPoint(row: Record<string, unknown>): KnowledgePoint {
  return {
    id: String(row.id),
    courseId: String(row.course_id),
    title: String(row.title),
    groupIndex: Number(row.group_index),
    sourceChunkIds: JSON.parse(String(row.source_ids)),
    state: row.state as KnowledgeState,
    streak: Number(row.streak),
    nextReviewAt: row.next_review_at as string | null,
    lastReviewedAt: row.last_reviewed_at as string | null,
    unfamiliar: Boolean(row.unfamiliar),
  };
}
export function listCourses(db: Store, owner: string): Course[] {
  return db
    .all<Record<string, unknown>>(
      `SELECT c.*,
    (SELECT COUNT(*) FROM documents d WHERE d.course_id=c.id) AS document_count,
    (SELECT COUNT(*) FROM points p WHERE p.course_id=c.id) AS point_count,
    (SELECT COUNT(*) FROM points p WHERE p.course_id=c.id AND p.state='mastered') AS mastered_count,
    (SELECT COUNT(*) FROM points p WHERE p.course_id=c.id AND p.state='developing') AS developing_count,
    (SELECT COUNT(*) FROM points p WHERE p.course_id=c.id AND p.next_review_at<=?) AS due_count,
    (SELECT COUNT(*) FROM stuck s WHERE s.course_id=c.id AND s.resolved=0) AS stuck_count
    FROM courses c WHERE owner=? ORDER BY created_at,id`,
      now(),
      owner,
    )
    .map((row) => ({
      id: String(row.id),
      name: String(row.name),
      shape: row.shape as Course['shape'],
      palette: row.palette as Course['palette'],
      examDate: row.exam_date as string | null,
      seaId: Number(row.sea_id),
      slotId: Number(row.slot_id),
      createdAt: String(row.created_at),
      documentCount: Number(row.document_count),
      pointCount: Number(row.point_count),
      masteredCount: Number(row.mastered_count),
      developingCount: Number(row.developing_count),
      dueCount: Number(row.due_count),
      stuckCount: Number(row.stuck_count),
      regions: db
        .all<{ group_index: number; level: number; due: number }>(
          `SELECT group_index,
        MAX(CASE WHEN state='mastered' THEN 3 WHEN streak>0 THEN 2 WHEN state='developing' THEN 1 ELSE 0 END) AS level,
        MAX(CASE WHEN next_review_at<=? THEN 1 ELSE 0 END) AS due FROM points WHERE course_id=? GROUP BY group_index`,
          now(),
          String(row.id),
        )
        .map((region) => ({ groupIndex: region.group_index, level: region.level, due: Boolean(region.due) })),
    }));
}
export function reviewTransition(
  streak: number,
  correct: boolean,
  hinted: boolean,
  examDate: string | null,
  timestamp = new Date(),
) {
  const nextStreak = correct && !hinted ? streak + 1 : 0;
  const state: KnowledgeState = nextStreak >= 2 ? 'mastered' : 'developing';
  const days = nextStreak <= 1 ? 1 : [3, 7, 14][Math.min(nextStreak - 2, 2)];
  let next = new Date(timestamp.getTime() + days * 86400000);
  if (examDate) {
    const exam = new Date(`${examDate}T00:00:00+08:00`);
    const beforeExam = new Date(exam.getTime() - 86400000);
    if (beforeExam > timestamp && beforeExam < next) next = beforeExam;
  }
  return { streak: nextStreak, state, nextReviewAt: next.toISOString() };
}
export function dateKey(date: Date | string, timezone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(date));
}
export function validateTimezone(zone: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone }).format();
    return true;
  } catch {
    return false;
  }
}
export function sourceRows(db: Store, courseId: string, sourceIds: string[]) {
  return sourceIds
    .map((sourceId) =>
      db.get<{ id: string; documentId: string; documentName: string; page: number; text: string }>(
        'SELECT c.id,c.document_id AS documentId,d.name AS documentName,c.page,c.text FROM chunks c JOIN documents d ON d.id=c.document_id WHERE c.id=? AND c.course_id=?',
        sourceId,
        courseId,
      ),
    )
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
}
export function assertSourceIds(db: Store, courseId: string, sourceIds: string[], allowed?: Set<string>) {
  if (
    !sourceIds.length ||
    new Set(sourceIds).size !== sourceIds.length ||
    sourceRows(db, courseId, sourceIds).length !== sourceIds.length ||
    sourceIds.some((value) => allowed && !allowed.has(value))
  ) {
    throw new AppError(422, '引用不属于当前课程或当前证据，已停止写入。', 'INVALID_SOURCE');
  }
}

/**
 * The knowledge point a page belongs to: the point citing the most passages on
 * that page, otherwise the one whose passages sit closest to it.
 */
export function pointForPage(db: Store, documentId: string, page: number) {
  const points = db.all<{ id: string; source_ids: string }>(
    'SELECT id,source_ids FROM points WHERE document_id=?',
    documentId,
  );
  let best: string | null = null,
    bestScore = -Infinity;
  for (const point of points) {
    const ids = JSON.parse(point.source_ids) as string[];
    if (!ids.length) continue;
    const pages = ids
      .map((sid) => db.get<{ page: number }>('SELECT page FROM chunks WHERE id=?', sid)?.page)
      .filter((value): value is number => typeof value === 'number');
    if (!pages.length) continue;
    const onPage = pages.filter((value) => value === page).length;
    const distance = Math.min(...pages.map((value) => Math.abs(value - page)));
    const score = onPage ? 100 + onPage : -distance;
    if (score > bestScore) {
      bestScore = score;
      best = point.id;
    }
  }
  return best;
}
/** Stuck notes put their knowledge point into the learner's knowledge graph. */
export function flagStuckPoint(db: Store, pointId: string | null) {
  if (pointId) db.run('UPDATE points SET unfamiliar=1 WHERE id=?', pointId);
}
/** One-off: older notes were saved without a point and never reached the graph. */
export function linkLegacyStuckNotes(db: Store) {
  if (db.get("SELECT name FROM schema_migrations WHERE name='stuck-graph'")) return;
  db.transaction(() => {
    for (const note of db.all<{ id: string; document_id: string; page: number }>(
      'SELECT id,document_id,page FROM stuck WHERE point_id IS NULL AND document_id IS NOT NULL AND page IS NOT NULL',
    )) {
      const pointId = pointForPage(db, note.document_id, note.page);
      if (pointId) db.run('UPDATE stuck SET point_id=? WHERE id=?', pointId, note.id);
    }
    db.run('UPDATE points SET unfamiliar=1 WHERE id IN (SELECT point_id FROM stuck WHERE resolved=0 AND point_id IS NOT NULL)');
    db.run("INSERT INTO schema_migrations(name) VALUES('stuck-graph')");
  });
}
