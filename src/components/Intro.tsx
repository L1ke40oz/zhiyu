// First-visit intro: pixel fog covers the sea, parts to reveal the island, then
// a few floating cloud bubbles point out what each part of the app does. Nothing
// here blocks the page; bubbles advance on their own and can be skipped.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.5;
const pack = (r: number, g: number, b: number, a = 255) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
const WHITE = pack(255, 255, 255),
  MIST = pack(240, 248, 247),
  SHADE = pack(208, 230, 231),
  RIM = pack(168, 204, 209);
const ease = (t: number) => (1 - Math.cos(Math.PI * t)) / 2;
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------- fog
const HOLD = 0.7,
  PART = 3;
/**
 * Pure fog renderer: `draw(t, px)` paints the frame at time t (seconds) into a
 * Uint32 pixel buffer of lw x lh. Puffs are painted top to bottom, each with a
 * white crown and a pale underside, so lower puffs overlap the shading of the
 * ones above: the layered look of a pixel-art sea of clouds.
 */
export function createFog(lw: number, lh: number, reducedMotion = false) {
  const random = seeded(20261025);
  const cx = lw / 2;
  const R_MIN = 10,
    R_VAR = 7,
    STEP_X = 15,
    STEP_Y = 11;
  const puffs: {
    x: number;
    y: number;
    r: number;
    dir: number;
    speed: number;
    lift: number;
    phase: number;
  }[] = [];
  for (let row = 0, y = -4; y < lh + R_MIN; row++, y += STEP_Y)
    for (let x = -STEP_X + (row % 2) * (STEP_X / 2); x < lw + STEP_X; x += STEP_X) {
      const x0 = x + (random() - 0.5) * 6,
        y0 = y + (random() - 0.5) * 4;
      // distance from the centre line decides how soon a puff leaves; both halves move alike
      const side = (x0 - cx) / (lw / 2);
      puffs.push({
        x: x0,
        y: y0,
        r: R_MIN + random() * R_VAR,
        dir: side < 0 ? -1 : 1,
        speed: 0.85 + Math.abs(side) * 0.45 + random() * 0.25,
        lift: (random() - 0.5) * 0.25,
        phase: random() * Math.PI * 2,
      });
    }
  puffs.sort((a, b) => a.y - b.y);
  const total = reducedMotion ? 0.6 : HOLD + PART;
  const travel = lw * 0.55 + (R_MIN + R_VAR) * 2;
  function draw(t: number, px: Uint32Array) {
    const p = reducedMotion ? 1 : ease(Math.min(1, Math.max(0, (t - HOLD) / PART)));
    // dissolve pixel by pixel over the last stretch
    const keep = reducedMotion ? 1 - Math.min(1, t / 0.6) : 1 - Math.max(0, (p - 0.62) / 0.38);
    px.fill(0);
    for (const puff of puffs) {
      const x = puff.x + puff.dir * p * travel * puff.speed + Math.sin(t * 0.9 + puff.phase) * 0.8,
        y = puff.y + puff.lift * p * lh * 0.4 + Math.cos(t * 0.7 + puff.phase) * 0.5,
        rx = puff.r * (1 + p * 0.25),
        ry = rx * 0.78;
      if (x + rx < 0 || x - rx > lw) continue;
      for (let yy = Math.max(0, Math.floor(y - ry)); yy <= Math.min(lh - 1, Math.ceil(y + ry)); yy++)
        for (let xx = Math.max(0, Math.floor(x - rx)); xx <= Math.min(lw - 1, Math.ceil(x + rx)); xx++) {
          const nx = (xx - x) / rx,
            ny = (yy - y) / ry;
          const d = nx * nx + ny * ny;
          // a dithered edge so the outline reads as hand-placed pixels
          if (d > 1 + bayer(xx, yy) * 0.18) continue;
          if (keep < 1 && bayer(xx * 3 + 1, yy * 3 + 2) + 0.5 > keep) continue;
          // underside crescent: outside a circle shifted up inside the puff
          const sx = nx,
            sy = ny + 0.42;
          const under = ny > 0.05 && sx * sx + sy * sy > 1.02;
          let c = WHITE;
          if (under) c = d > 0.8 ? RIM : SHADE;
          else if (ny < -0.55 && d > 0.7) c = WHITE;
          else if (d > 0.86 && ny > -0.2) c = MIST;
          px[yy * lw + xx] = c;
        }
    }
    // the first instant is fully white so nothing peeks through before the clouds part
    if (!reducedMotion && p < 0.08) {
      const veil = 1 - p / 0.08;
      for (let i = 0; i < px.length; i++)
        if (!px[i] && bayer(i % lw, (i / lw) | 0) + 0.5 < veil) px[i] = MIST;
    }
  }
  return { draw, total };
}

const FOG_PX = 5;
export function Fog({ reducedMotion, onDone }: { reducedMotion: boolean; onDone: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const canvas = ref.current!;
    const lw = Math.ceil(window.innerWidth / FOG_PX) + 2,
      lh = Math.ceil(window.innerHeight / FOG_PX) + 2;
    canvas.width = lw;
    canvas.height = lh;
    const ctx = canvas.getContext('2d')!;
    const image = ctx.createImageData(lw, lh);
    const px = new Uint32Array(image.data.buffer);
    const fog = createFog(lw, lh, reducedMotion);
    let raf = 0;
    const start = performance.now();
    const frame = (now: number) => {
      const t = (now - start) / 1000;
      fog.draw(t, px);
      ctx.putImageData(image, 0, 0);
      if (t < fog.total) raf = requestAnimationFrame(frame);
      else done.current();
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [reducedMotion]);
  return <canvas ref={ref} className="intro-fog" aria-hidden="true" />;
}

// ---------------------------------------------------------------- bubble
const BUBBLE_PX = 3;
interface Tip {
  target: string;
  title: string;
  text: string;
}
export const TIPS: Tip[] = [
  {
    target: '.px-registry',
    title: '岛屿登记处',
    text: '点灯塔，或者岛上任意一块空地，就能为一门课开辟土地。',
  },
  {
    target: '.px-label.px-course, .px-label.px-empty',
    title: '每门课是一块地',
    text: '知识点学得越熟，地上的花草树木越茂盛；该复习的地方会飘起薄雾。',
  },
  {
    target: '[data-tour="read"]',
    title: '课件共读',
    text: '上传 PDF、PPTX 或图片，边读边划线、问 AI，不懂的地方随手记成卡点。',
  },
  {
    target: '[data-tour="review"]',
    title: '复习计划',
    text: '按遗忘规律安排每天要回访的知识点，答一道小测，小岛就长大一点。',
  },
  {
    target: '[data-tour="party"]',
    title: '派对码头',
    text: '学累了，和身边的人用手机扫码，一起玩几局小游戏。',
  },
  {
    target: '[data-tour="profile"]',
    title: '个人中心',
    text: '看看自己的学习热力图，也可以接上你自己的 AI 接口。',
  },
];
const MARGIN = 46; // room around the bubble for wobbling bumps and the tail puffs

/** Pixel cloud whose bumps breathe, plus a two-puff tail toward (tx, ty). */
function CloudCanvas({
  width,
  height,
  tail,
  still,
}: {
  width: number;
  height: number;
  tail: { x: number; y: number } | null;
  still: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const lw = Math.ceil((width + MARGIN * 2) / BUBBLE_PX),
      lh = Math.ceil((height + MARGIN * 2) / BUBBLE_PX);
    canvas.width = lw;
    canvas.height = lh;
    const ctx = canvas.getContext('2d')!;
    const image = ctx.createImageData(lw, lh);
    const px = new Uint32Array(image.data.buffer);
    const inside = new Uint8Array(lw * lh);
    const m = MARGIN / BUBBLE_PX,
      w = width / BUBBLE_PX,
      h = height / BUBBLE_PX;
    const cx = m + w / 2,
      cy = m + h / 2;
    // bumps along the rim of a rounded rectangle
    const bumps: { x: number; y: number; r: number; phase: number; speed: number }[] = [];
    const random = seeded(Math.round(width * 7 + height));
    const along = (len: number, count: number, at: (k: number) => [number, number], r: number) => {
      for (let k = 0; k < count; k++) {
        const [x, y] = at((k + 0.5) / count);
        bumps.push({
          x,
          y,
          r: r * (0.85 + random() * 0.4),
          phase: random() * 6.28,
          speed: 0.9 + random() * 0.9,
        });
      }
      void len;
    };
    const rb = Math.min(h * 0.42, 9);
    const nx = Math.max(3, Math.round(w / (rb * 1.5))),
      ny = Math.max(1, Math.round(h / (rb * 1.7)));
    along(w, nx, (f) => [m + rb * 0.6 + f * (w - rb * 1.2), m + rb * 0.35], rb);
    along(w, nx, (f) => [m + rb * 0.6 + f * (w - rb * 1.2), m + h - rb * 0.35], rb * 0.9);
    along(h, ny, (f) => [m + rb * 0.35, m + rb + f * (h - rb * 2)], rb);
    along(h, ny, (f) => [m + w - rb * 0.35, m + rb + f * (h - rb * 2)], rb);
    const puffs = tail
      ? [0.42, 0.75].map((f, k) => {
          // from the bubble edge toward the target
          const tx = tail.x / BUBBLE_PX + m,
            ty = tail.y / BUBBLE_PX + m;
          const ex = Math.max(m + rb, Math.min(m + w - rb, tx)),
            ey = ty < cy ? m : m + h;
          return { x: ex + (tx - ex) * f, y: ey + (ty - ey) * f, r: k ? 2.2 : 3.4 };
        })
      : [];
    let raf = 0,
      last = -1;
    const start = performance.now();
    const draw = (now: number) => {
      const t = still ? 0 : (now - start) / 1000;
      if (!still) raf = requestAnimationFrame(draw);
      if (t - last < 1 / 14 && last >= 0) return;
      last = t;
      inside.fill(0);
      for (let y = 0; y < lh; y++)
        for (let x = 0; x < lw; x++) {
          let hit = x >= m + rb * 0.3 && x <= m + w - rb * 0.3 && y >= m + rb * 0.3 && y <= m + h - rb * 0.3;
          if (!hit)
            for (const b of bumps) {
              const r = b.r * (1 + 0.16 * Math.sin(t * b.speed + b.phase));
              const dx = x - b.x - Math.sin(t * 0.7 + b.phase) * 0.6,
                dy = y - b.y;
              if (dx * dx + dy * dy <= r * r) {
                hit = true;
                break;
              }
            }
          if (!hit)
            for (const p of puffs) {
              const r = p.r * (1 + 0.12 * Math.sin(t * 1.6 + p.x));
              const dx = x - p.x,
                dy = y - p.y + Math.sin(t * 1.2 + p.y) * 0.5;
              if (dx * dx + dy * dy <= r * r) {
                hit = true;
                break;
              }
            }
          inside[y * lw + x] = hit ? 1 : 0;
        }
      for (let y = 0; y < lh; y++)
        for (let x = 0; x < lw; x++) {
          const i = y * lw + x;
          if (!inside[i]) {
            // soft drop shadow two pixels below the cloud
            px[i] = y > 2 && inside[i - 2 * lw] && !inside[i - lw * 0] ? pack(36, 65, 74, 46) : 0;
            continue;
          }
          const edge = !inside[i - 1] || !inside[i + 1] || !inside[i - lw] || !inside[i + lw];
          const lower = y > cy + h * 0.28 && (!inside[i + 2 * lw] || !inside[i + 3 * lw]);
          px[i] = edge ? RIM : lower ? SHADE : WHITE;
        }
      ctx.putImageData(image, 0, 0);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height, tail?.x, tail?.y, still]);
  return (
    <canvas
      ref={ref}
      className="cloud-canvas"
      style={{ left: -MARGIN, top: -MARGIN, width: width + MARGIN * 2, height: height + MARGIN * 2 }}
      aria-hidden="true"
    />
  );
}

export function TipBubbles({ reducedMotion, onFinish }: { reducedMotion: boolean; onFinish: () => void }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [box, setBox] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
    tail: { x: number; y: number } | null;
  } | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const tips = TIPS;
  const tip = tips[index];
  const next = () => (index + 1 < tips.length ? setIndex(index + 1) : onFinish());

  // auto-advance; hovering or focusing the bubble pauses it
  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(next, 6500);
    return () => window.clearTimeout(timer);
  });
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onFinish();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onFinish]);

  // place the bubble next to its target, above it when the target is low on screen
  useLayoutEffect(() => {
    const place = () => {
      const target = document.querySelector(tip.target);
      const width = Math.min(268, window.innerWidth - 56);
      const height = body.current?.offsetHeight || 120;
      if (!target) {
        setBox({
          left: (window.innerWidth - width) / 2,
          top: window.innerHeight * 0.3,
          width,
          height,
          tail: null,
        });
        return;
      }
      const r = target.getBoundingClientRect();
      const below = r.top + r.height / 2 < window.innerHeight * 0.5;
      const gap = 54;
      const left = Math.min(window.innerWidth - width - 24, Math.max(24, r.left + r.width / 2 - width / 2));
      const top = below ? r.bottom + gap : r.top - gap - height;
      setBox({
        left,
        top: Math.max(16, top),
        width,
        height,
        tail: { x: r.left + r.width / 2 - left, y: (below ? r.bottom + 4 : r.top - 4) - Math.max(16, top) },
      });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [index, tip.target]);

  return (
    <div className="intro-tips" aria-live="polite">
      <div
        className={`cloud-bubble ${reducedMotion ? '' : 'floating'}`}
        key={index}
        style={box ? { left: box.left, top: box.top, width: box.width } : { visibility: 'hidden' }}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
        role="dialog"
        aria-label={`功能介绍：${tip.title}`}
      >
        {box ? (
          <CloudCanvas width={box.width} height={box.height} tail={box.tail} still={reducedMotion} />
        ) : null}
        <div className="cloud-body" ref={body}>
          <b>{tip.title}</b>
          <p>{tip.text}</p>
          <div className="cloud-actions">
            <span className="cloud-dots" aria-label={`第 ${index + 1} 条，共 ${tips.length} 条`}>
              {tips.map((_, k) => (
                <i key={k} className={k === index ? 'on' : ''} />
              ))}
            </span>
            <button type="button" className="cloud-skip" onClick={onFinish}>
              跳过
            </button>
            <button type="button" className="cloud-next" onClick={next}>
              {index + 1 < tips.length ? '下一条' : '开始吧'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Intro({
  reducedMotion,
  onRevealed,
  onFinish,
}: {
  reducedMotion: boolean;
  onRevealed: () => void;
  onFinish: () => void;
}) {
  const [phase, setPhase] = useState<'fog' | 'tips'>('fog');
  return phase === 'fog' ? (
    <Fog
      reducedMotion={reducedMotion}
      onDone={() => {
        onRevealed();
        setPhase('tips');
      }}
    />
  ) : (
    <TipBubbles reducedMotion={reducedMotion} onFinish={onFinish} />
  );
}
