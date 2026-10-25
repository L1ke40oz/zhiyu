import test from 'node:test';
import assert from 'node:assert/strict';
import { outline, outlinePoints, sectionHeading } from '../server/services/structure.ts';

// shaped like a real chapter deck: section title repeated on every slide,
// numbered list items inside slides, a meta slide and a contents slide
const pages = [
  '课程教学要求\n能够应用编程技术解决软件工程应用问题',
  '第1章 Java入门\n主要内容\nJava的地位；\nJava的特点；',
  '1.1 Java的地位\nJava属于面向对象程序语言，特别适合于Internet的应用开发。',
  '1.1 Java的地位\n网络是信息时代最重要的交互媒介。',
  '1.2 Java 的特点\n1．平台与机器指令\n平台是由操作系统和处理器所构成。',
  '1.2 Java 的特点\n3．Java虚拟机与字节码\nJava语言提供的编译器不针对特定的操作系统。',
  '1.3 安装JDK\n1.3.1 三种平台简介\nJava SE 称为Java标准版。',
  '1.3 安装JDK\n1.3.2 安装Java SE平台\n登录Oracle的网站下载JDK。',
  '1.4 Java程序的开发步骤\n3.使用java解释器来解释执行字节码文件。\n3. 运行程序',
  '1.5简单的Java应用程序\nJava应用程序的源文件是由若干个类组成。',
  '1.5 简单的Java应用程序\n一个Java应用程序必须有一个类含有main方法。',
].map((text, index) => ({ number: index + 1, text }));
const chunks = pages.map((page) => ({ id: `c${page.number}`, page: page.number }));

test('只把带层级编号或“第N章”的行当成章节标题，列表项不算', () => {
  assert.deepEqual(sectionHeading('1.2 Java 的特点'), { key: '1.2', title: '1.2 Java 的特点' });
  assert.deepEqual(sectionHeading('1.5简单的Java应用程序'), { key: '1.5', title: '1.5 简单的Java应用程序' });
  assert.equal(sectionHeading('3. 运行程序'), null);
  assert.equal(sectionHeading('1．平台与机器指令'), null);
  assert.equal(sectionHeading('1.2 这是一句完整的话。'), null);
  assert.equal(sectionHeading('第1章 Java入门')?.key, '第1章');
});

test('按章节生成知识点：每节一个、不重复、不遗漏，跳过教学要求和目录页', () => {
  const sections = outline(pages);
  assert.deepEqual(
    sections.filter((section) => section.meta).map((section) => section.title),
    ['课程教学要求', '第1章 Java入门'],
  );
  const points = outlinePoints(pages, chunks)!;
  assert.deepEqual(
    points.map((point) => point.title),
    ['1.1 Java的地位', '1.2 Java 的特点', '1.3 安装JDK', '1.4 Java程序的开发步骤', '1.5 简单的Java应用程序'],
  );
  // a section cites every passage on its slides
  assert.deepEqual(points[1].sourceChunkIds, ['c5', 'c6']);
  assert.deepEqual(points[4].sourceChunkIds, ['c10', 'c11']);
  // regions follow reading order, not round-robin
  assert.deepEqual(
    points.map((point) => point.groupIndex),
    [0, 0, 1, 1, 2],
  );
});

test('多章资料按章划分知识区；没有章节标题的笔记返回 null 走原来的分段', () => {
  const multi = [
    '2.1 数组\n数组是相同类型元素的集合。',
    '2.2 链表\n链表由结点组成。',
    '3.1 栈\n栈是后进先出的结构。',
  ].map((text, index) => ({ number: index + 1, text }));
  const points = outlinePoints(multi, multi.map((page) => ({ id: `m${page.number}`, page: page.number })))!;
  assert.deepEqual(
    points.map((point) => point.groupIndex),
    [0, 0, 1],
  );
  const notes = [{ number: 1, text: '今天讲了极限的定义。\n\n极限描述函数值的趋势。' }];
  assert.equal(outlinePoints(notes, [{ id: 'n1', page: 1 }]), null);
});
