/* =========================================================
   摇可乐（加速度计）
   每次剧烈晃动算一下，摇满目标次数瓶盖飞出。
   没有加速度计时：点击屏幕 / 空格键 = 摇一下。
   ========================================================= */
import { addHint, clamp } from './util.js';

export function create(stage, ctx) {
  const target = ctx.params.target || 24;
  const root = document.createElement('div');
  root.className = 'shake-game';
  root.innerHTML = `
    <div class="shake-count"><b>0</b> / ${target}</div>
    <div class="bottle">
      <div class="bottle-cap"></div>
      <div class="bottle-neck"></div>
      <div class="bottle-body"><div class="bottle-fizz"></div><span>COLA</span></div>
    </div>`;
  stage.appendChild(root);
  const countEl = root.querySelector('.shake-count b');
  const bottle = root.querySelector('.bottle');
  const fizz = root.querySelector('.bottle-fizz');

  if (!ctx.sensors.hasMotion) addHint(stage, '没有加速度计：疯狂点击屏幕代替摇晃');

  const startedAt = performance.now();
  let count = 0;
  let done = false;

  const off = ctx.sensors.onShake(() => {
    if (done) return;
    count++;
    countEl.textContent = count;
    fizz.style.height = `${clamp(count / target, 0, 1) * 100}%`;
    // 瓶子跟着抖一下
    bottle.classList.remove('jiggle');
    void bottle.offsetWidth;
    bottle.classList.add('jiggle');
    ctx.progress(count / target);
    if (count >= target) {
      done = true;
      root.classList.add('popped');
      ctx.win(clamp(1 - (performance.now() - startedAt) / (ctx.duration * 1000), 0.05, 1));
    }
  });

  return {
    end: () => ({ success: false, score: clamp(count / target, 0, 1) * 0.9 }),
    destroy: off,
  };
}
