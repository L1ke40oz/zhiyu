import test from 'node:test';
import assert from 'node:assert/strict';
import { sectionChunks, readableTitle, repairLegacyTitles } from '../server/services/structure.ts';
import { openDatabase } from '../server/db.ts';

test('空行包裹的短标题也形成独立章节，不把整页当一个知识点', () => {
  const result = sectionChunks(
    '函数与极限\n\n函数描述两个变量之间确定的对应关系。\n\n连续与间断\n\n连续需要函数值、极限与两者相等这三个条件。\n\n导数与变化率\n\n导数是函数在某一点的瞬时变化率。',
  );
  assert.deepEqual(
    result.map((item) => item.title),
    ['函数与极限', '连续与间断', '导数与变化率'],
  );
});

test('知识分段保留章节和完整句子，标题不截半句话', () => {
  const a = '条件概率讨论已知某事件发生时的概率。',
    b = '独立事件中一个事件发生不会改变另一个事件的概率。';
  const sections = sectionChunks(`# 条件概率\n${a.repeat(30)}\n# 独立事件\n${b.repeat(12)}`, 220);
  assert.ok(sections.length > 3);
  assert.ok(sections.every((item) => /^(条件概率|独立事件)/.test(item.title)));
  assert.ok(sections.every((item) => /[。]$/.test(item.text)));
  assert.equal(
    sections
      .map((item) => item.text)
      .join('')
      .replace(/# 条件概率|# 独立事件|\s/g, ''),
    a.repeat(30) + b.repeat(12),
  );
  assert.equal(readableTitle('这是一句很长的课件内容'.repeat(10), '第 3 页阅读要点'), '第 3 页阅读要点');
});
test('旧标题修复保留手动命名和原有学习证据', () => {
  const db = openDatabase(':memory:');
  try {
    db.run("INSERT INTO profiles VALUES('owner','{}','now')");
    db.run("INSERT INTO courses VALUES('course','owner','课','bean','sage',NULL,0,0,'now')");
    db.run(
      "INSERT INTO documents(id,owner,course_id,name,mime,filename,hash,status,created_at) VALUES('doc','owner','course','资料','text/plain','x','x','ready','now')",
    );
    const text = '接着前面的推导来看这一条件在后续过程中的具体作用'.repeat(4);
    db.run(
      "INSERT INTO pages(document_id,number,text,method) VALUES('doc',1,?,'native')",
      '# 条件概率\n第一段定义。\n' + text,
    );
    db.run("INSERT INTO chunks(id,document_id,course_id,page,text) VALUES('chunk','doc','course',1,?)", text);
    for (const [id, title] of [
      ['p1', text.slice(0, 36)],
      ['p2', '我自己的名称'],
    ])
      db.run(
        "INSERT INTO points(id,course_id,document_id,title,group_index,source_ids,state,streak) VALUES(?,'course','doc',?,0,'[\"chunk\"]','mastered',2)",
        id,
        title,
      );
    repairLegacyTitles(db);
    assert.equal(db.get<{ title: string }>("SELECT title FROM points WHERE id='p1'")!.title, '条件概率');
    assert.equal(db.get<{ title: string }>("SELECT title FROM points WHERE id='p2'")!.title, '我自己的名称');
    assert.equal(db.get<{ streak: number }>("SELECT streak FROM points WHERE id='p1'")!.streak, 2);
  } finally {
    db.close();
  }
});
