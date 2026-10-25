import test from 'node:test';
import assert from 'node:assert/strict';
import { oceanLayout, COURSES_PER_SEA } from '../shared/ocean-layout.ts';
import { openDatabase } from '../server/db.ts';
import { nextCourseSlot } from '../server/domain.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('六个固定区域在手机与桌面均可点击，登记处独立，岛屿数量不影响大小', () => {
  for (const [width, height] of [
    [360, 554],
    [390, 758],
    [430, 846],
    [768, 1024],
    [1280, 720],
    [1920, 1080],
  ]) {
    const layout = oceanLayout(width, height);
    assert.equal(layout.courses.length, COURSES_PER_SEA);
    for (const [index, point] of layout.courses.entries()) {
      assert.equal(point.size, layout.courses[0].size);
      assert.ok(point.x - point.size / 2 >= 0 && point.x + point.size / 2 <= width);
      assert.ok(point.y - point.size / 2 >= 0 && point.y + point.size * 0.34 + 32 < layout.usableHeight);
      for (const other of layout.courses.slice(index + 1))
        assert.ok(
          Math.abs(point.x - other.x) >= point.size || Math.abs(point.y - other.y) >= point.size * 0.92,
        );
      const registry = layout.registry;
      assert.ok(
        Math.abs(point.x - registry.x) >= (point.size + registry.size) / 2 ||
          Math.abs(point.y - registry.y) >= (point.size + registry.size) * 0.46,
      );
    }
    assert.ok(layout.registry.x < width * 0.25);
    assert.deepEqual(layout, oceanLayout(width, height));
  }
});
test('三岛海域升级为六岛，唯一约束不冲突，学习数据保留且重启不重复迁移', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyu-sea-migrate-'));
  const filename = path.join(directory, 'state.sqlite');
  let db = openDatabase(filename);
  try {
    db.run("INSERT INTO profiles VALUES('owner','{}','now')");
    for (let index = 0; index < 8; index++)
      db.run(
        'INSERT INTO courses VALUES(?,?,?,?,?,?,?,?,?)',
        `c${index}`,
        'owner',
        `课程${index}`,
        'bean',
        'sage',
        null,
        Math.floor(index / 3),
        index % 3,
        'now',
      );
    db.run("INSERT INTO events VALUES('event','owner','c6','reading','已有记录','message','now')");
    db.run("DELETE FROM schema_migrations WHERE name='six-course-seas'");
    db.close();
    db = openDatabase(filename);
    const check = () => {
      for (let index = 0; index < 8; index++) {
        const row = db.get<{ sea_id: number; slot_id: number }>(
          'SELECT sea_id,slot_id FROM courses WHERE id=?',
          `c${index}`,
        )!;
        assert.equal(row.sea_id, Math.floor(index / 6));
        assert.equal(row.slot_id, index % 6);
      }
    };
    check();
    assert.ok(db.get("SELECT id FROM events WHERE id='event'"));
    assert.deepEqual(nextCourseSlot(db, 'owner'), { seaId: 1, slotId: 2 });
    db.close();
    db = openDatabase(filename);
    check();
    db.run("UPDATE courses SET sea_id=4,slot_id=5 WHERE id='c1'");
    assert.deepEqual(nextCourseSlot(db, 'owner'), { seaId: 0, slotId: 1 });
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
