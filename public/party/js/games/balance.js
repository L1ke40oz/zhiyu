/* =========================================================
   端水大师（陀螺仪）
   手机放平，水珠随倾斜滚动，还有一股会转向的“风”捣乱。
   在中心圈内停留的时间占比 ≥ 55% 即成功（不能提前结束，要撑满全程）。
   ========================================================= */
import { addHint, clamp, createCanvas, loop } from './util.js';

const PASS = 0.55;

export function create(stage, ctx) {
  const { g, w, h } = createCanvas(stage);
  const sensors = ctx.sensors;
  const R = Math.min(w, h) * 0.42;       // 托盘半径
  const r = R * 0.34;                     // 中心目标圈半径
  const ball = R * 0.09;
  const cx = w / 2;
  const cy = h / 2;
  const windPower = (ctx.params.wind || 1) * R * 0.45;

  if (!sensors.hasMotion) addHint(stage, '没有陀螺仪：按住屏幕拖动来抵抗风');

  let x = 0, y = 0, vx = 0, vy = 0;
  let windAngle = Math.random() * Math.PI * 2;
  let inside = 0;
  let elapsed = 0;

  const stop = loop((dt, now) => {
    elapsed += dt;
    windAngle += dt * (0.8 + Math.sin(now / 900) * 0.6);
    const grav = sensors.gravity();
    // 倾斜加速度 + 风；阻尼让手感更“水”
    const ax = grav.x * R * 4 + Math.cos(windAngle) * windPower;
    const ay = grav.y * R * 4 + Math.sin(windAngle) * windPower;
    vx = (vx + ax * dt) * 0.97;
    vy = (vy + ay * dt) * 0.97;
    x += vx * dt;
    y += vy * dt;
    // 托盘边缘：反弹
    const d = Math.hypot(x, y);
    const maxD = R - ball;
    if (d > maxD) {
      const nx = x / d, ny = y / d;
      x = nx * maxD;
      y = ny * maxD;
      const vn = vx * nx + vy * ny;
      vx -= 1.6 * vn * nx;
      vy -= 1.6 * vn * ny;
    }
    const isIn = Math.hypot(x, y) < r;
    if (isIn) inside += dt;
    ctx.progress(clamp(inside / (ctx.duration * PASS), 0, 1));
    draw(isIn);
  });

  function draw(isIn) {
    g.fillStyle = '#fff8e7';
    g.fillRect(0, 0, w, h);
    // 托盘
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.fillStyle = '#d7ecff';
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = '#111214';
    g.stroke();
    // 目标圈
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fillStyle = isIn ? '#bff0cf' : '#ffffff';
    g.fill();
    g.setLineDash([10, 8]);
    g.lineWidth = 4;
    g.strokeStyle = isIn ? '#22b35e' : '#111214';
    g.stroke();
    g.setLineDash([]);
    // 水珠
    g.beginPath();
    g.arc(cx + x, cy + y, ball, 0, Math.PI * 2);
    g.fillStyle = '#2d9cdb';
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = '#111214';
    g.stroke();
    g.beginPath();
    g.arc(cx + x - ball * 0.3, cy + y - ball * 0.3, ball * 0.25, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,255,255,.8)';
    g.fill();
    // 圈内时间占比
    const pct = elapsed > 0 ? Math.round((inside / ctx.duration) * 100) : 0;
    g.fillStyle = '#111214';
    g.font = '900 22px sans-serif';
    g.textAlign = 'center';
    g.fillText(`圈内 ${pct}% · 目标 ${Math.round(PASS * 100)}%`, cx, cy + R + 40);
  }

  return {
    end() {
      const ratio = clamp(inside / ctx.duration, 0, 1);
      return { success: ratio >= PASS, score: ratio };
    },
    destroy: stop,
  };
}
