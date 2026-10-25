// One island per sea. The island is a single landmass split into six plots
// (one per course slot) by sandy paths, plus a lighthouse islet that serves as
// the registry. Everything is deterministic for a given sea index.

export type Orientation = 'landscape' | 'portrait';
export const PATH = 6;
export const ISLET = 7;
export const WATER = -1;

export interface Plot {
  slot: number;
  cx: number;
  cy: number;
  pole: { x: number; y: number };
  boundary: number[];
  area: number;
}
export interface World {
  w: number;
  h: number;
  orientation: Orientation;
  seed: number;
  /** -1 water, 0..5 plot, PATH, ISLET */
  cell: Int8Array;
  /** distance (px) to the nearest pixel that is not the same plot */
  inner: Float32Array;
  plots: Plot[];
  islet: { x: number; y: number; r: number };
  bridge: { x0: number; y0: number; x1: number; y1: number };
  dock: { x: number; y: number };
}

const LAYOUTS: Record<
  Orientation,
  { w: number; h: number; r: number; plots: number[][]; islet: number[] }
> = {
  landscape: {
    w: 256,
    h: 176,
    r: 36,
    plots: [
      [64, 66],
      [128, 58],
      [192, 68],
      [66, 120],
      [128, 124],
      [190, 116],
    ],
    islet: [24, 28],
  },
  portrait: {
    w: 184,
    h: 256,
    r: 33,
    plots: [
      [58, 80],
      [126, 74],
      [56, 134],
      [128, 132],
      [60, 190],
      [124, 194],
    ],
    islet: [154, 26],
  },
};

export function hash2(x: number, y: number, seed: number) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function valueNoise(x: number, y: number, seed: number) {
  const xi = Math.floor(x),
    yi = Math.floor(y),
    xf = x - xi,
    yf = y - yi;
  const u = xf * xf * (3 - 2 * xf),
    v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed),
    b = hash2(xi + 1, yi, seed),
    c = hash2(xi, yi + 1, seed),
    d = hash2(xi + 1, yi + 1, seed);
  const top = a + (b - a) * u,
    bottom = c + (d - c) * u;
  return top + (bottom - top) * v;
}
export function fbm(x: number, y: number, seed: number) {
  return (
    valueNoise(x, y, seed) * 0.58 +
    valueNoise(x * 2.07, y * 2.07, seed + 17) * 0.3 +
    valueNoise(x * 4.3, y * 4.3, seed + 31) * 0.12
  );
}
export function rng(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Two-pass chamfer distance transform. `source[i]` true means distance 0. */
export function distanceField(w: number, h: number, source: (i: number) => boolean, cap = 255) {
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = source(i) ? 0 : cap;
  const o = 1,
    g = 1.414;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + o);
      if (y > 0) {
        v = Math.min(v, d[i - w] + o);
        if (x > 0) v = Math.min(v, d[i - w - 1] + g);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + g);
      }
      d[i] = v;
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + o);
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + o);
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + g);
        if (x > 0) v = Math.min(v, d[i + w - 1] + g);
      }
      d[i] = v;
    }
  return d;
}

function flood(w: number, h: number, start: number[], pass: (i: number) => boolean) {
  const seen = new Uint8Array(w * h);
  const stack = start.filter(pass);
  for (const i of stack) seen[i] = 1;
  while (stack.length) {
    const i = stack.pop()!,
      x = i % w,
      y = (i / w) | 0;
    const next = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
    for (const n of next)
      if (n >= 0 && !seen[n] && pass(n)) {
        seen[n] = 1;
        stack.push(n);
      }
  }
  return seen;
}

const cache = new Map<string, World>();
export function createWorld(orientation: Orientation, sea: number): World {
  const key = `${orientation}:${sea}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const layout = LAYOUTS[orientation];
  const { w, h } = layout;
  const seed = 9137 + sea * 7919;
  const random = rng(seed);
  const centers = layout.plots.map(([x, y]) => [x + (random() - 0.5) * 9, y + (random() - 0.5) * 8]);
  // a few peninsulas so the coast is not a rounded rectangle
  const lobes = Array.from({ length: 4 }, () => {
    const a = random() * Math.PI * 2;
    return [w / 2 + Math.cos(a) * w * 0.4, h / 2 + Math.sin(a) * h * 0.38, 13 + random() * 7];
  });
  const [ix, iy] = layout.islet;
  const isletR = 10.5;
  const R2 = layout.r * layout.r;

  // Land: metaballs around plot centres, wobbled by noise.
  const land = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let f = 0;
      for (const [cx, cy] of centers) {
        const dx = x - cx,
          dy = (y - cy) * 1.1;
        f += R2 / (dx * dx + dy * dy + 1);
      }
      for (const [lx, ly, lr] of lobes) f += (lr * lr) / ((x - lx) ** 2 + ((y - ly) * 1.1) ** 2 + 1);
      const n = fbm(x * 0.045, y * 0.045, seed) - 0.5;
      const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
      if (f * (1 + n * 1.05) > 1.08 && edge > 6 && Math.hypot(x - ix, y - iy) > isletR + 9) land[y * w + x] = 1;
      const ni = fbm(x * 0.2, y * 0.2, seed + 5) - 0.5;
      if (Math.hypot(x - ix, (y - iy) * 1.15) < isletR + ni * 5) land[y * w + x] = 2;
    }
  // Fill lakes, drop stray specks.
  const sea0 = flood(
    w,
    h,
    Array.from({ length: w }, (_, x) => x).concat(Array.from({ length: h }, (_, y) => y * w)),
    (i) => !land[i],
  );
  for (let i = 0; i < w * h; i++) if (!land[i] && !sea0[i]) land[i] = 1;
  const mainStart = Math.round(centers[1][1]) * w + Math.round(centers[1][0]);
  const main = flood(w, h, [mainStart], (i) => land[i] === 1);
  const isle = flood(w, h, [iy * w + ix], (i) => land[i] === 2);
  for (let i = 0; i < w * h; i++) if (!main[i] && !isle[i]) land[i] = 0;

  // Plots: warped Voronoi, borders become paths.
  const cell = new Int8Array(w * h).fill(WATER);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!land[i]) continue;
      if (land[i] === 2) {
        cell[i] = ISLET;
        continue;
      }
      const qx = x + (fbm(x * 0.07, y * 0.07, seed + 11) - 0.5) * 12,
        qy = y + (fbm(x * 0.07, y * 0.07, seed + 23) - 0.5) * 12;
      let best = 0,
        d1 = Infinity,
        d2 = Infinity;
      centers.forEach(([cx, cy], k) => {
        const d = Math.hypot(qx - cx, qy - cy);
        if (d < d1) {
          d2 = d1;
          d1 = d;
          best = k;
        } else if (d < d2) d2 = d;
      });
      cell[i] = d2 - d1 < 2.6 ? PATH : best;
    }
  const inner = distanceField(w, h, (i) => cell[i] < 0 || cell[i] >= PATH);
  const plots: Plot[] = centers.map(([cx, cy], slot) => {
    let pole = { x: Math.round(cx), y: Math.round(cy) },
      best = -Infinity,
      area = 0;
    const boundary: number[] = [];
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (cell[i] !== slot) continue;
        area++;
        const score = Math.min(inner[i], 13) - Math.hypot(x - cx, y - cy) * 0.12;
        if (score > best) {
          best = score;
          pole = { x, y };
        }
        if (cell[i - 1] !== slot || cell[i + 1] !== slot || cell[i - w] !== slot || cell[i + w] !== slot)
          boundary.push(i);
      }
    return { slot, cx, cy, pole, boundary, area };
  });

  // Bridge from islet to the closest point of the main island.
  let bx = ix,
    by = iy,
    bd = Infinity;
  for (let i = 0; i < w * h; i++)
    if (land[i] === 1) {
      const x = i % w,
        y = (i / w) | 0,
        d = Math.hypot(x - ix, y - iy);
      if (d < bd) {
        bd = d;
        bx = x;
        by = y;
      }
    }
  const ux = (bx - ix) / bd,
    uy = (by - iy) / bd;
  const bridge = { x0: ix + ux * (isletR - 3), y0: iy + uy * (isletR - 3), x1: bx - ux * 1, y1: by - uy * 1 };

  // Dock: southernmost path pixel near the middle.
  let dock = { x: Math.round(w / 2), y: 0 },
    dockScore = -Infinity;
  for (let i = w; i < w * (h - 1); i++) {
    const x = i % w,
      y = (i / w) | 0;
    if (land[i] !== 1 || cell[i + w] !== WATER || Math.abs(x - w / 2) > w * 0.25) continue;
    const score = y + (cell[i] === PATH ? 12 : 0) - Math.abs(x - w / 2) * 0.2;
    if (score > dockScore) {
      dockScore = score;
      dock = { x, y };
    }
  }
  const world: World = {
    w,
    h,
    orientation,
    seed,
    cell,
    inner,
    plots,
    islet: { x: ix, y: iy, r: isletR },
    bridge,
    dock,
  };
  cache.set(key, world);
  return world;
}
