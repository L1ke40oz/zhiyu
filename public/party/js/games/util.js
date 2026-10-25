/* 微游戏公共工具
   每个微游戏模块导出 create(stage, ctx)，返回 { end(), destroy() }：
   - ctx.params    服务端下发的关卡参数（所有玩家相同）
   - ctx.duration  时长（秒），由外壳负责倒计时
   - ctx.progress(p) 上报进度 0~1（大屏实时显示）
   - ctx.win(score)  提前过关，score 0~1 越高名次越前
   - end()         时间到时由外壳调用，返回 { success, score }
   - destroy()     清理事件和动画 */

export function clamp(x, min, max) {
  return Math.min(max, Math.max(min, x));
}

/** 创建铺满舞台的高清画布 */
export function createCanvas(stage) {
  const canvas = document.createElement('canvas');
  canvas.className = 'game-canvas';
  stage.appendChild(canvas);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = stage.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);
  return { canvas, g, w: rect.width, h: rect.height };
}

/** requestAnimationFrame 循环，回调参数为秒级 dt；返回停止函数 */
export function loop(fn) {
  let last = performance.now();
  let id = requestAnimationFrame(function tick(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    fn(dt, now);
    id = requestAnimationFrame(tick);
  });
  return () => cancelAnimationFrame(id);
}

/** 舞台上的提示文字（例如“无陀螺仪：拖动屏幕代替倾斜”） */
export function addHint(stage, text) {
  const el = document.createElement('div');
  el.className = 'game-hint';
  el.textContent = text;
  stage.appendChild(el);
  return el;
}
