/* =========================================================
   微游戏目录（服务端）
   服务端只负责“出题”：选哪个游戏、时长、参数。
   所有玩家拿到同一份参数（同一个目标颜色、同一侧的杯子），保证公平。
   实际玩法和判定在手机端 public/js/games/*.js 本地完成，零网络延迟。
   ========================================================= */

export const COLORS = {
  red: { id: 'red', name: '红色', swatch: '#e53935' },
  orange: { id: 'orange', name: '橙色', swatch: '#fb8c00' },
  yellow: { id: 'yellow', name: '黄色', swatch: '#fdd835' },
  green: { id: 'green', name: '绿色', swatch: '#43a047' },
  blue: { id: 'blue', name: '蓝色', swatch: '#1e88e5' },
};

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export const GAMES = [
  {
    id: 'sand',
    title: '倒沙子',
    verb: '倒！',
    hint: '倾斜手机，把沙子倒进杯子里',
    duration: 10,
    sensor: 'motion',
    params: () => ({ side: Math.random() < 0.5 ? 'left' : 'right' }),
  },
  {
    id: 'color',
    title: '找颜色',
    verb: '找！',
    hint: '用摄像头找到指定颜色，对准稳住',
    duration: 9,
    sensor: 'camera',
    params: () => ({ color: pick(Object.values(COLORS)) }),
  },
  {
    id: 'shake',
    title: '摇可乐',
    verb: '摇！',
    hint: '疯狂摇晃手机，把瓶盖摇飞',
    duration: 6,
    sensor: 'motion',
    params: () => ({ target: 24 }),
  },
  {
    id: 'balance',
    title: '端水大师',
    verb: '端平！',
    hint: '把手机放平，别让水珠跑出中间的圈',
    duration: 8,
    sensor: 'motion',
    params: () => ({ wind: 0.7 + Math.random() * 0.5 }),
  },
  {
    id: 'blow',
    title: '吹蜡烛',
    verb: '吹！',
    hint: '对着手机底部的麦克风用力吹气',
    duration: 7,
    sensor: 'mic',
    params: () => ({ candles: 3 }),
  },
];

/** 生成本局的关卡序列：打乱顺序，不足时循环补齐，并避免同一游戏连续出现 */
export function pickPlaylist(count) {
  const list = [];
  while (list.length < count) {
    const bag = shuffle([...GAMES]);
    if (list.length && bag[0].id === list[list.length - 1].id) bag.push(bag.shift());
    list.push(...bag);
  }
  return list.slice(0, count).map((g) => ({
    id: g.id,
    title: g.title,
    verb: g.verb,
    hint: g.hint,
    duration: g.duration,
    sensor: g.sensor,
    params: g.params(),
  }));
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
