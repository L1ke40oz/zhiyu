/* =========================================================
   吹蜡烛（麦克风）
   对着麦克风孔吹气时，气流会产生很强的风噪（人耳听不到，麦克风能收到），
   表现为音量（RMS）明显高于环境底噪。
   不同手机麦克风灵敏度差别很大，所以门槛不写死，而是跟着环境底噪自适应：
     门槛 = max(MIN_LEVEL, 底噪 × NOISE_RATIO)
   累计吹气够时长熄灭一根蜡烛。没有麦克风时：按住屏幕 = 吹气。
   ========================================================= */
import { addHint, clamp, loop } from './util.js';

const MIN_LEVEL = 0.03;    // 门槛下限：再低就容易被环境声误触
const NOISE_RATIO = 3;     // 比底噪高出几倍算吹气
const PER_CANDLE = 0.45;   // 每根蜡烛需要累计吹气的秒数
const METER_LINE = 0.4;    // 音量条上门槛线的位置（40%）

export function create(stage, ctx) {
  const n = ctx.params.candles || 3;
  const root = document.createElement('div');
  root.className = 'blow-game';
  root.innerHTML = `
    <div class="cake">
      <div class="candles">${'<div class="candle"><i class="flame"></i></div>'.repeat(n)}</div>
      <div class="cake-body"></div>
    </div>
    <div class="mic-meter"><div class="mic-fill"></div><div class="mic-line"></div></div>
    <div class="mic-tip">对准手机<b>底部的麦克风孔</b>吹，越近越好</div>
    <div class="mic-debug"></div>`;
  stage.appendChild(root);
  const flames = [...root.querySelectorAll('.flame')];
  const micFill = root.querySelector('.mic-fill');
  const debug = root.querySelector('.mic-debug');
  root.querySelector('.mic-line').style.left = `${METER_LINE * 100}%`;

  if (!ctx.sensors.hasMic) addHint(stage, '没有麦克风：按住屏幕代替吹气');

  const startedAt = performance.now();
  let blown = 0;
  let done = false;
  // 环境底噪：从后台测量值起步（关卡开场期间就在测），之后继续自适应
  let floor = ctx.sensors.ambientLevel || 0.01;
  let frame = 0;

  const stop = loop((dt) => {
    const level = ctx.sensors.micLevel();
    const threshold = Math.max(MIN_LEVEL, floor * NOISE_RATIO);
    const blowing = level >= threshold;

    // 底噪：变安静时快速跟上，变吵时缓慢上调；吹气期间不更新，避免把吹气当成底噪
    if (level < floor) floor = floor * 0.9 + level * 0.1;
    else if (!blowing) floor += (level - floor) * 0.01;

    if (blowing && !done) blown += dt;

    // 音量条按门槛归一化：越过黑线就是在“吹”
    micFill.style.width = `${clamp((level / threshold) * METER_LINE, 0, 1) * 100}%`;
    micFill.classList.toggle('on', blowing);
    if (++frame % 6 === 0) {
      debug.textContent = `音量 ${level.toFixed(3)} · 门槛 ${threshold.toFixed(3)} · 音频 ${ctx.sensors.audioState}`;
    }

    const out = Math.min(n, Math.floor(blown / PER_CANDLE));
    flames.forEach((f, i) => {
      f.classList.toggle('out', i < out);
      // 还亮着的火苗随气流摇晃
      f.style.setProperty('--sway', blowing ? `${(Math.random() - 0.5) * 30}deg` : '0deg');
    });
    ctx.progress(blown / (PER_CANDLE * n));
    if (!done && out >= n) {
      done = true;
      ctx.win(clamp(1 - (performance.now() - startedAt) / (ctx.duration * 1000), 0.05, 1));
    }
  });

  return {
    end: () => ({ success: false, score: clamp(blown / (PER_CANDLE * n), 0, 1) * 0.9 }),
    destroy: stop,
  };
}
