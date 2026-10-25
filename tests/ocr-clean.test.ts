import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanText, ocrSupplement } from '../server/services/documents.ts';

const native = '性质 3 ：如果 A 、 B 和 C 是有限集合，则有\n|A ∪ B ∪ C| ＝ |A| ＋ |B| ＋ |C| － |A ∩ B| － |A ∩ C|\n－ |B ∩ C| ＋ |A ∩ B ∩ C| 。\nB A\nC';

test('有文字层的页面只补充图片里的新文字，丢弃图形误识别和重复内容', () => {
  const lines = [
    { text: '国庆', confidence: 88 },
    { text: '性 质 3: 如 果 A、B 和 (C 是 有 限 集 合 ， 则 有', confidence: 90 },
    { text: '|AUBUC|=|A|+|B|+|C|—|ANB|—|ANC]|', confidence: 70 },
    { text: '全 中', confidence: 80 },
    { text: '由', confidence: 60 },
    { text: '图 4-1 三 个 集 合 的 文 氏 图 示 意', confidence: 86 },
  ];
  assert.equal(ocrSupplement(native, lines), '图 4-1 三个集合的文氏图示意');
});

test('清洗中文字符间空格和单独的页码行', () => {
  assert.equal(cleanText('性 质 3: 如 果 A、B\n12\n第 3 页\n有 限 集 合 。'), '性质 3: 如果 A、B\n\n有限集合。');
});

test('整页 OCR 去掉孤立单字、低置信度碎片和行首孤立标点', async () => {
  const { ocrPageText } = await import('../server/services/documents.ts');
  const lines = [
    { text: '全', confidence: 70 },
    { text: '“作业 :', confidence: 80 },
    { text: '。P52 4.1 (本题不抄题 )', confidence: 82 },
    { text: '~~', confidence: 30 },
    { text: '4.10 (提示 : 利用 4.3，4.6 )', confidence: 85 },
  ];
  assert.equal(ocrPageText(lines, ''), '作业 :\nP52 4.1 (本题不抄题 )\n4.10 (提示 : 利用 4.3，4.6 )');
});

test('只合并逐字隔开的中文，保留词与词之间本来的空格', async () => {
  const { cleanText } = await import('../server/services/documents.ts');
  assert.equal(cleanText('第三章 路由与交换'), '第三章 路由与交换');
  assert.equal(cleanText('是 有 限 集 合 ， 则 有'), '是有限集合，则有');
  assert.equal(cleanText('A、B 和 (C 是 有 限'), 'A、B 和 (C 是有限');
});
