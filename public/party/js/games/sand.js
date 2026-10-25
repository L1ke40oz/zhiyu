/* =========================================================
   倒沙子（陀螺仪）
   落沙元胞自动机：每个格子是 空 / 墙 / 沙。
   重力方向来自手机倾斜，量化为 8 个方向之一；
   沙粒优先沿重力方向移动，被挡住时尝试两个 45° 斜向，自然堆出沙堆。
   布局：上方一个罐子，侧面有开口；下方同侧有一个杯子。
   玩法：侧倾把沙从开口倒出，再扶正让沙落进杯子。
   ========================================================= */
import { addHint, clamp, createCanvas, loop } from './util.js';

const W = 48;
const H = 80;
const EMPTY = 0, WALL = 1, SAND = 2;
const WIN_RATIO = 0.45; // 杯中沙量达到总量 45% 即过关（倒的过程中难免洒一些）

// 8 个方向，按角度顺序排列，相邻元素相差 45°
const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const SAND_COLORS = [[236, 190, 98], [222, 172, 80], [245, 205, 120]];

export function create(stage, ctx) {
  const { g, w, h } = createCanvas(stage);
  const sensors = ctx.sensors;
  const left = ctx.params.side !== 'right';

  const grid = new Uint8Array(W * H);
  const tone = new Uint8Array(W * H);
  const moved = new Uint32Array(W * H);
  let stamp = 0;

  // 罐子与杯子的位置（left 时开口和杯子都在左边，right 时镜像）
  const mx = (x) => (left ? x : W - 1 - x);
  const jar = { x0: 14, x1: 33, y0: 8, y1: 29 };        // 罐子内部
  // 杯子贴着屏幕边缘：外侧杯壁就是屏幕边框，侧倾时洒出的沙会顺着边框滑进杯里
  const cup = { x0: 1, x1: 17, y0: 62, y1: 76 };        // 杯子内部（左侧坐标）

  const setWall = (x, y) => { grid[y * W + x] = WALL; };
  for (let x = 0; x < W; x++) { setWall(x, 0); setWall(x, H - 1); }
  for (let y = 0; y < H; y++) { setWall(0, y); setWall(W - 1, y); }
  for (let x = jar.x0 - 1; x <= jar.x1 + 1; x++) { setWall(x, jar.y0 - 1); setWall(x, jar.y1 + 1); }
  for (let y = jar.y0 - 1; y <= jar.y1 + 1; y++) {
    // 开口：靠杯子一侧的侧壁上方 6 格
    if (!(y >= jar.y0 && y <= jar.y0 + 5)) setWall(mx(jar.x0 - 1), y);
    setWall(mx(jar.x1 + 1), y);
  }
  for (let y = cup.y0 - 2; y <= cup.y1 + 1; y++) { setWall(mx(cup.x0 - 1), y); setWall(mx(cup.x1 + 1), y); }
  for (let x = cup.x0 - 1; x <= cup.x1 + 1; x++) setWall(mx(x), cup.y1 + 1);

  // 装沙：罐子下半部分装满
  let total = 0;
  for (let y = jar.y0 + 6; y <= jar.y1; y++) {
    for (let x = jar.x0; x <= jar.x1; x++) {
      grid[y * W + x] = SAND;
      tone[y * W + x] = (Math.random() * SAND_COLORS.length) | 0;
      total++;
    }
  }
  const target = Math.ceil(total * WIN_RATIO);
  const cupX0 = Math.min(mx(cup.x0), mx(cup.x1));
  const cupX1 = Math.max(mx(cup.x0), mx(cup.x1));

  // 离屏小画布：每个格子 1 像素，绘制时放大
  const off = document.createElement('canvas');
  off.width = W;
  off.height = H;
  const og = off.getContext('2d');
  const img = og.createImageData(W, H);
  const cell = Math.min(w / W, h / H);
  const ox = (w - W * cell) / 2;
  const oy = (h - H * cell) / 2;

  if (!sensors.hasMotion) addHint(stage, '没有陀螺仪：按住屏幕拖动来“倾斜”');

  let inCup = 0;
  let done = false;

  function step(dir) {
    stamp++;
    const [dx, dy] = DIRS[dir];
    const side1 = DIRS[(dir + 1) % 8];
    const side2 = DIRS[(dir + 7) % 8];
    // 从“下游”往“上游”扫描，避免同一帧里沙粒被连续推进多格
    const xs = dx > 0 || (dx === 0 && stamp & 1) ? -1 : 1;
    const ys = dy > 0 ? -1 : 1;
    for (let j = 0; j < H; j++) {
      const y = ys < 0 ? H - 1 - j : j;
      for (let i = 0; i < W; i++) {
        const x = xs < 0 ? W - 1 - i : i;
        const idx = y * W + x;
        if (grid[idx] !== SAND || moved[idx] === stamp) continue;
        let to = tryCell(x + dx, y + dy);
        if (to < 0) {
          const [a, b] = Math.random() < 0.5 ? [side1, side2] : [side2, side1];
          to = tryCell(x + a[0], y + a[1]);
          if (to < 0) to = tryCell(x + b[0], y + b[1]);
        }
        if (to >= 0) {
          grid[to] = SAND;
          tone[to] = tone[idx];
          grid[idx] = EMPTY;
          moved[to] = stamp;
        }
      }
    }
  }

  function tryCell(x, y) {
    if (x < 0 || y < 0 || x >= W || y >= H) return -1;
    const i = y * W + x;
    return grid[i] === EMPTY ? i : -1;
  }

  function countCup() {
    let n = 0;
    for (let y = cup.y0; y <= cup.y1; y++) {
      for (let x = cupX0; x <= cupX1; x++) if (grid[y * W + x] === SAND) n++;
    }
    return n;
  }

  function render() {
    const d = img.data;
    for (let i = 0; i < W * H; i++) {
      const p = i * 4;
      const v = grid[i];
      if (v === WALL) { d[p] = 17; d[p + 1] = 18; d[p + 2] = 20; d[p + 3] = 255; }
      else if (v === SAND) {
        const c = SAND_COLORS[tone[i]];
        d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2]; d[p + 3] = 255;
      } else d[p + 3] = 0;
    }
    og.putImageData(img, 0, 0);

    g.fillStyle = '#fff8e7';
    g.fillRect(0, 0, w, h);
    // 杯子内部高亮 + 目标刻度线
    g.fillStyle = '#ffe9a8';
    g.fillRect(ox + cupX0 * cell, oy + cup.y0 * cell, (cupX1 - cupX0 + 1) * cell, (cup.y1 - cup.y0 + 1) * cell);
    const cupW = cupX1 - cupX0 + 1;
    const lineY = cup.y1 + 1 - Math.ceil(target / cupW);
    g.strokeStyle = '#e53935';
    g.setLineDash([6, 5]);
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(ox + cupX0 * cell, oy + lineY * cell);
    g.lineTo(ox + (cupX1 + 1) * cell, oy + lineY * cell);
    g.stroke();
    g.setLineDash([]);

    g.imageSmoothingEnabled = false;
    g.drawImage(off, ox, oy, W * cell, H * cell);

    g.fillStyle = '#111214';
    g.font = `900 ${Math.round(cell * 3.2)}px sans-serif`;
    g.textAlign = 'center';
    g.fillText(`${Math.min(100, Math.round((inCup / target) * 100))}%`, ox + ((cupX0 + cupX1 + 1) / 2) * cell, oy + (cup.y0 - 4) * cell);
  }

  const stop = loop(() => {
    // 无输入时默认竖直拿着（重力朝下）
    const grav = sensors.gravity({ x: 0, y: 1 });
    const mag = Math.hypot(grav.x, grav.y);
    if (mag > 0.2) {
      const angle = Math.atan2(grav.y, grav.x);
      const dir = (Math.round(angle / (Math.PI / 4)) + 8) % 8;
      const steps = clamp(Math.round(mag * 3), 1, 3);
      for (let s = 0; s < steps; s++) step(dir);
    }
    inCup = countCup();
    ctx.progress(inCup / target);
    render();
    if (!done && inCup >= target) {
      done = true;
      ctx.win(clamp(inCup / total, 0, 1));
    }
  });

  return {
    end: () => ({ success: false, score: clamp(inCup / total, 0, 1) }),
    destroy: stop,
  };
}
