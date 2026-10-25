import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import { COURSES_PER_SEA } from '../shared/ocean-layout.ts';

export function openDatabase(filename = path.join(config.dataDir, 'zhiyu.sqlite')) {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY, settings TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS courses (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES profiles(id), name TEXT NOT NULL,
      shape TEXT NOT NULL, palette TEXT NOT NULL, exam_date TEXT, sea_id INTEGER NOT NULL,
      slot_id INTEGER NOT NULL, created_at TEXT NOT NULL, UNIQUE(owner,sea_id,slot_id)
    );
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES profiles(id), course_id TEXT NOT NULL REFERENCES courses(id),
      name TEXT NOT NULL, mime TEXT NOT NULL, filename TEXT NOT NULL, hash TEXT NOT NULL,
      status TEXT NOT NULL, progress INTEGER NOT NULL DEFAULT 0, page_count INTEGER NOT NULL DEFAULT 0,
      warnings TEXT NOT NULL DEFAULT '[]', error TEXT, created_at TEXT NOT NULL,
      UNIQUE(owner,course_id,hash)
    );
    CREATE TABLE IF NOT EXISTS pages (
      document_id TEXT NOT NULL REFERENCES documents(id), number INTEGER NOT NULL, text TEXT NOT NULL,
      method TEXT NOT NULL, warning TEXT, has_image INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(document_id,number)
    );
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id), course_id TEXT NOT NULL REFERENCES courses(id),
      page INTEGER NOT NULL, text TEXT NOT NULL, embedding TEXT
    );
    CREATE TABLE IF NOT EXISTS points (
      id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id), document_id TEXT NOT NULL REFERENCES documents(id),
      title TEXT NOT NULL, group_index INTEGER NOT NULL, source_ids TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'unexplored',
      streak INTEGER NOT NULL DEFAULT 0, next_review_at TEXT, last_reviewed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS stuck (
      id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id), point_id TEXT REFERENCES points(id),
      document_id TEXT REFERENCES documents(id), page INTEGER, text TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id), document_id TEXT REFERENCES documents(id),
      role TEXT NOT NULL, text TEXT NOT NULL, sections TEXT NOT NULL DEFAULT '[]', sources TEXT NOT NULL DEFAULT '[]',
      mode TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reading_sessions (
      id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id),
      title TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS quizzes (
      id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id), point_id TEXT NOT NULL REFERENCES points(id),
      prompt TEXT NOT NULL, options TEXT NOT NULL, correct_option_id TEXT NOT NULL, explanation TEXT NOT NULL,
      source_ids TEXT NOT NULL, mode TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_images (
      id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      owner TEXT NOT NULL REFERENCES profiles(id), course_id TEXT NOT NULL REFERENCES courses(id),
      filename TEXT NOT NULL, name TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS chat_images_course ON chat_images(course_id,owner);
    CREATE TABLE IF NOT EXISTS web_settings (
      owner TEXT PRIMARY KEY REFERENCES profiles(id), mode TEXT NOT NULL DEFAULT 'site', secret TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS message_tools (
      message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE, events TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS attempts (
      id TEXT PRIMARY KEY, quiz_id TEXT NOT NULL REFERENCES quizzes(id), owner TEXT NOT NULL,
      option_id TEXT NOT NULL, correct INTEGER NOT NULL, hinted INTEGER NOT NULL, result TEXT NOT NULL,
      created_at TEXT NOT NULL, UNIQUE(owner,quiz_id)
    );
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES profiles(id), course_id TEXT REFERENCES courses(id),
      type TEXT NOT NULL, title TEXT NOT NULL, source_id TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(owner,type,source_id)
    );
    CREATE TABLE IF NOT EXISTS reading_positions (
      owner TEXT NOT NULL, document_id TEXT NOT NULL REFERENCES documents(id), page INTEGER NOT NULL,
      PRIMARY KEY(owner,document_id)
    );
    CREATE TABLE IF NOT EXISTS idempotency (
      owner TEXT NOT NULL, operation TEXT NOT NULL, request_id TEXT NOT NULL, response TEXT NOT NULL,
      PRIMARY KEY(owner,operation,request_id)
    );
    CREATE INDEX IF NOT EXISTS courses_owner ON courses(owner);
    CREATE INDEX IF NOT EXISTS chunks_course ON chunks(course_id);
    CREATE INDEX IF NOT EXISTS points_course ON points(course_id);
    CREATE INDEX IF NOT EXISTS events_owner ON events(owner,created_at);
    CREATE TABLE IF NOT EXISTS model_settings (
      owner TEXT PRIMARY KEY REFERENCES profiles(id), mode TEXT NOT NULL DEFAULT 'site',
      base TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', secret TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS service_model_settings (
      owner TEXT NOT NULL REFERENCES profiles(id), kind TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'site', base TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '', secret TEXT NOT NULL DEFAULT '', PRIMARY KEY(owner,kind)
    );
    CREATE TABLE IF NOT EXISTS highlights (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES profiles(id),
      document_id TEXT NOT NULL REFERENCES documents(id), page INTEGER NOT NULL,
      start_offset INTEGER NOT NULL, end_offset INTEGER NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(owner,document_id,page,start_offset,end_offset)
    );
    CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY);
  `);
  // Preserve course IDs and all learning records while expanding old seas.
  // Stage outside the normal coordinate range to avoid UNIQUE collisions.
  db.exec('BEGIN IMMEDIATE');
  try {
    const messageColumns = db.prepare('PRAGMA table_info(messages)').all() as { name: string }[];
    if (!messageColumns.some((column) => column.name === 'session_id'))
      db.exec('ALTER TABLE messages ADD COLUMN session_id TEXT REFERENCES reading_sessions(id)');
    db.exec('CREATE INDEX IF NOT EXISTS messages_session ON messages(course_id,session_id)');
    if (!db.prepare('SELECT name FROM schema_migrations WHERE name=?').get('six-course-seas')) {
      const courses = db
        .prepare('SELECT id,sea_id,slot_id FROM courses ORDER BY owner,sea_id,slot_id')
        .all() as { id: string; sea_id: number; slot_id: number }[];
      db.exec('UPDATE courses SET sea_id=-sea_id-1');
      const update = db.prepare('UPDATE courses SET sea_id=?,slot_id=? WHERE id=?');
      for (const course of courses) {
        const ordinal = course.sea_id * 3 + course.slot_id;
        update.run(Math.floor(ordinal / COURSES_PER_SEA), ordinal % COURSES_PER_SEA, course.id);
      }
      db.prepare('INSERT INTO schema_migrations(name) VALUES(?)').run('six-course-seas');
    }
    // learners can flag points they find unfamiliar; flagged points form the knowledge graph
    if (!db.prepare('SELECT name FROM schema_migrations WHERE name=?').get('point-unfamiliar')) {
      const columns = db.prepare('PRAGMA table_info(points)').all() as { name: string }[];
      if (!columns.some((column) => column.name === 'unfamiliar'))
        db.exec('ALTER TABLE points ADD COLUMN unfamiliar INTEGER NOT NULL DEFAULT 0');
      db.prepare('INSERT INTO schema_migrations(name) VALUES(?)').run('point-unfamiliar');
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    db.close();
    throw error;
  }
  return {
    raw: db,
    get<T = Record<string, unknown>>(sql: string, ...params: SQLInputValue[]): T | undefined {
      return db.prepare(sql).get(...params) as T | undefined;
    },
    all<T = Record<string, unknown>>(sql: string, ...params: SQLInputValue[]): T[] {
      return db.prepare(sql).all(...params) as T[];
    },
    run(sql: string, ...params: SQLInputValue[]) {
      return db.prepare(sql).run(...params);
    },
    transaction<T>(fn: () => T): T {
      db.exec('BEGIN IMMEDIATE');
      try {
        const value = fn();
        db.exec('COMMIT');
        return value;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    close() {
      db.close();
    },
  };
}
export type Store = ReturnType<typeof openDatabase>;
