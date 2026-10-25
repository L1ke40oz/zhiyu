import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../server/db.ts';

test('服务重启后课程槽位、匿名身份和学习事件可恢复，事务失败不留下半条进度', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyu-persist-'));
  const filename = path.join(directory, 'state.sqlite');
  let db = openDatabase(filename);
  try {
    db.run('INSERT INTO profiles VALUES(?,?,?)', 'owner', '{}', '2026-10-24T12:00:00Z');
    db.run(
      'INSERT INTO courses VALUES(?,?,?,?,?,?,?,?,?)',
      'course',
      'owner',
      '高等数学',
      'crescent',
      'lilac',
      null,
      2,
      1,
      '2026-10-24T12:00:00Z',
    );
    db.run(
      'INSERT INTO events VALUES(?,?,?,?,?,?,?)',
      'event',
      'owner',
      'course',
      'reading',
      '完成共读',
      'message',
      '2026-10-24T12:00:00Z',
    );
    assert.throws(
      () =>
        db.transaction(() => {
          db.run('UPDATE courses SET name=? WHERE id=?', '不该保存的名字', 'course');
          db.run(
            'INSERT INTO events VALUES(?,?,?,?,?,?,?)',
            'rolled-back',
            'owner',
            'course',
            'review',
            '未完成的复习',
            'failed-attempt',
            '2026-10-24T12:00:01Z',
          );
          throw new Error('模拟提交中断');
        }),
      /模拟提交中断/,
    );
    db.close();
    db = openDatabase(filename);
    assert.ok(db.get('SELECT id FROM profiles WHERE id=?', 'owner'));
    assert.deepEqual(
      { ...db.get<Record<string, unknown>>('SELECT name,sea_id,slot_id FROM courses WHERE id=?', 'course')! },
      { name: '高等数学', sea_id: 2, slot_id: 1 },
    );
    assert.equal(db.all('SELECT id FROM events').length, 1);
    assert.equal(db.get('SELECT id FROM events WHERE id=?', 'rolled-back'), undefined);
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
