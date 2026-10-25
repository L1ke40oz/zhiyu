/* =========================================================
   找颜色（摄像头）
   沿用 color-hunt 的判定：取景框中心区域平均色 → HSV → 主要比较色相，
   饱和度/明度只设宽松下限。连续匹配 400ms 过关。
   ========================================================= */
import { addHint, clamp } from './util.js';

const SAMPLE_MS = 100;
const HOLD_MS = 400;
const GRACE_MS = 150;
const THRESHOLD = 0.6;
const SAMPLE_RATIO = 0.6;
const N = 32;
const SV_BAND = 0.12;

// 阈值设计详见 color-hunt/app.js 中的说明
const SPECS = {
  red: { hue: 0, hueCore: 14, hueFall: 22, sMin: 0.45, vMin: 0.25 },
  orange: { hue: 28, hueCore: 9, hueFall: 12, sMin: 0.5, vMin: 0.5 },
  yellow: { hue: 54, hueCore: 11, hueFall: 12, sMin: 0.35, vMin: 0.45 },
  green: { hue: 125, hueCore: 38, hueFall: 20, sMin: 0.22, vMin: 0.18 },
  blue: { hue: 215, hueCore: 28, hueFall: 18, sMin: 0.25, vMin: 0.18 },
};

export function create(stage, ctx) {
  const target = ctx.params.color;
  const spec = SPECS[target.id];
  stage.style.setProperty('--target', target.swatch);

  const root = document.createElement('div');
  root.className = 'color-game';
  root.innerHTML = `
    <video playsinline muted autoplay></video>
    <div class="color-target"><i></i><b></b></div>
    <div class="color-reticle"><div class="color-ring"></div><div class="color-sample"></div></div>
    <div class="color-meter"><div class="color-meter-fill"></div></div>`;
  stage.appendChild(root);
  root.querySelector('.color-target b').textContent = `找到${target.name}`;

  const video = root.querySelector('video');
  const reticle = root.querySelector('.color-reticle');
  const ring = root.querySelector('.color-ring');
  const meter = root.querySelector('.color-meter-fill');

  const canvas = document.createElement('canvas');
  canvas.width = N;
  canvas.height = N;
  const g = canvas.getContext('2d', { willReadFrequently: true });

  let best = 0;
  let holdStart = null;
  let lastMatch = 0;
  let done = false;
  let timer = 0;
  const startedAt = performance.now();

  if (!ctx.sensors.hasCamera) {
    addHint(stage, '没有可用的摄像头，这关只能看别人表演了 😅');
  } else {
    video.srcObject = ctx.sensors.stream;
    video.play().catch(() => {});
    timer = setInterval(tick, SAMPLE_MS);
  }

  function tick() {
    const rgb = sample();
    if (!rgb) return;
    const score = matchScore(rgbToHsv(rgb.r, rgb.g, rgb.b), spec);
    best = Math.max(best, score);
    const now = performance.now();
    const matched = score >= THRESHOLD;
    if (matched) {
      if (holdStart === null) holdStart = now;
      lastMatch = now;
    } else if (holdStart !== null && now - lastMatch > GRACE_MS) {
      holdStart = null;
    }
    const held = holdStart === null ? 0 : now - holdStart;
    meter.style.width = `${Math.round(score * 100)}%`;
    meter.classList.toggle('on', matched);
    reticle.classList.toggle('on', matched);
    ring.style.setProperty('--p', clamp(held / HOLD_MS, 0, 1));
    ctx.progress(Math.max(score * 0.8, clamp(held / HOLD_MS, 0, 1)));
    if (!done && matched && held >= HOLD_MS) {
      done = true;
      ctx.win(clamp(1 - (now - startedAt) / (ctx.duration * 1000), 0.05, 1));
    }
  }

  /** 把取景框换算到视频帧坐标（视频为 object-fit: cover），截取中心区域求平均色 */
  function sample() {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh || video.readyState < 2) return null;
    const vr = video.getBoundingClientRect();
    const rr = reticle.getBoundingClientRect();
    const scale = Math.max(vr.width / vw, vr.height / vh);
    const offX = (vr.width - vw * scale) / 2;
    const offY = (vr.height - vh * scale) / 2;
    const cx = (rr.left + rr.width / 2 - vr.left - offX) / scale;
    const cy = (rr.top + rr.height / 2 - vr.top - offY) / scale;
    const size = Math.min((rr.width * SAMPLE_RATIO) / scale, vw, vh);
    const sx = clamp(cx - size / 2, 0, vw - size);
    const sy = clamp(cy - size / 2, 0, vh - size);
    g.drawImage(video, sx, sy, size, size, 0, 0, N, N);
    const d = g.getImageData(0, 0, N, N).data;
    const rad = N / 2;
    let r = 0, gg = 0, b = 0, n = 0;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const dx = x + 0.5 - rad;
        const dy = y + 0.5 - rad;
        if (dx * dx + dy * dy > rad * rad) continue;
        const i = (y * N + x) * 4;
        r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++;
      }
    }
    return { r: r / n, g: gg / n, b: b / n };
  }

  return {
    end: () => ({ success: false, score: best * 0.5 }),
    destroy() {
      clearInterval(timer);
      video.pause();
      video.srcObject = null; // 只解除绑定，不停止共享的摄像头流
    },
  };
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

function matchScore({ h, s, v }, spec) {
  let dh = Math.abs(h - spec.hue) % 360;
  if (dh > 180) dh = 360 - dh;
  const hueScore = clamp(1 - Math.max(0, dh - spec.hueCore) / spec.hueFall, 0, 1);
  const soft = (val, min) => clamp((val - (min - SV_BAND)) / SV_BAND, 0, 1);
  return hueScore * soft(s, spec.sMin) * soft(v, spec.vMin);
}
