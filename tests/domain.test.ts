import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewTransition, dateKey } from '../server/domain.ts';
import { courseSchema, quizSchema, validate } from '../server/contracts.ts';
import { randomUUID } from 'node:crypto';
import { splitText } from '../server/services/documents.ts';

test('复习进度区分提示、独立作答与过去的考试日期', () => {
  const timestamp = new Date('2026-10-24T12:00:00Z');
  const first = reviewTransition(0, true, false, null, timestamp);
  assert.equal(first.state, 'developing');
  assert.equal(first.streak, 1);
  assert.equal(first.nextReviewAt, '2026-10-25T12:00:00.000Z');
  assert.equal(reviewTransition(1, true, false, null, timestamp).state, 'mastered');
  assert.equal(reviewTransition(2, true, true, null, timestamp).state, 'developing');
  assert.equal(reviewTransition(3, false, false, null, timestamp).streak, 0);
  assert.ok(new Date(reviewTransition(5, true, false, '2025-01-01', timestamp).nextReviewAt) > timestamp);
  assert.equal(
    reviewTransition(3, true, false, '2026-10-28', timestamp).nextReviewAt,
    '2026-10-26T16:00:00.000Z',
  );
});
test('学习热力图按用户时区跨日', () => {
  assert.equal(dateKey('2026-10-24T17:30:00Z', 'Asia/Singapore'), '2026-10-25');
  assert.equal(dateKey('2026-10-24T17:30:00Z', 'America/New_York'), '2026-10-24');
});
test('Schema 拒绝错类型、额外字段与无效日期', () => {
  const good = { name: '高等数学', shape: 'bean', palette: 'sage', requestId: randomUUID(), examDate: null };
  assert.doesNotThrow(() => validate(courseSchema, good));
  for (const invalid of [
    { ...good, name: 1 },
    { ...good, injected: true },
    { ...good, examDate: '2026-02-31' },
  ])
    assert.throws(() => validate(courseSchema, invalid));
  assert.throws(() => validate(quizSchema, { schemaVersion: 1, prompt: '题目没有选项' }));
});
test('长段落切分保留内容与局部上下文，不只保存摘要', () => {
  const text = `条件概率与独立事件。${'定义需要保留所有限定条件和公式。'.repeat(200)}`;
  const chunks = splitText(text);
  assert.ok(chunks.length > 2);
  assert.ok(chunks.every((chunk) => chunk.length <= 1000));
  assert.ok(chunks[0].includes('条件概率'));
  assert.ok(chunks[1].startsWith(chunks[0].slice(-100)));
});
