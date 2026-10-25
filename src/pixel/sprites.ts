// Procedural pixel sprites. Every sprite is painted into a tiny RGBA buffer,
// then given a 1px dark outline so it reads crisply on any terrain.
import type { Palette } from '../../shared/types';

export const C = {
  outline: '#33413b',
  deep2: '#4fb0b8',
  deep: '#5cbdc0',
  mid: '#71cac6',
  shallow: '#8fd9cd',
  shallow2: '#b1e8d6',
  foam: '#f1fff6',
  sand: '#f3e0ad',
  sandL: '#f9ecc6',
  sandD: '#e4ca93',
  wetSand: '#d8c393',
  cliffLip: '#6e8d4c',
  cliff: '#cfae7f',
  cliffL: '#dcc092',
  cliffD: '#b8966a',
  cliffDD: '#957756',
  grassLL: '#c4e695',
  grassL: '#a8d67b',
  grass: '#8fc86a',
  grassD: '#77b65b',
  grassDD: '#5f9d4e',
  path: '#efe0b4',
  pathL: '#f8eecd',
  pathD: '#dcc795',
  soil: '#d5b383',
  soilL: '#e2c697',
  soilD: '#c09b6c',
  soilDD: '#a8845a',
  trunk: '#9b7048',
  trunkD: '#7a5537',
  wood: '#c38f5d',
  woodL: '#dcae78',
  woodD: '#9c6c43',
  wall: '#fbf2dc',
  wallD: '#e6d6b6',
  wallDD: '#cdbb98',
  window: '#ffe39a',
  windowL: '#fff6d4',
  door: '#8d6446',
  stone: '#bfc4bd',
  stoneL: '#dde0d6',
  stoneD: '#959d98',
  leafL: '#a6d57a',
  leaf: '#82bd62',
  leafD: '#5f9e52',
  leafDD: '#4b8447',
  pineL: '#7fbf73',
  pine: '#5ea463',
  pineD: '#468a55',
  white: '#fffdf4',
  red: '#e07a63',
  redD: '#bf5d4c',
};

export const ROOF: Record<Palette, string> = {
  apricot: '#e0896a',
  sage: '#5f9f86',
  lilac: '#9b8bd0',
  sky: '#6ea9cf',
};

function hexToRgb(hex: string) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
export function mix(a: string, b: string, t: number) {
  const x = hexToRgb(a),
    y = hexToRgb(b);
  return (
    '#' +
    x
      .map((v, i) => Math.round(v + (y[i] - v) * t))
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
  );
}
export const lighten = (c: string, t = 0.28) => mix(c, '#fff8e1', t);
export const darken = (c: string, t = 0.25) => mix(c, '#253040', t);
const packed = new Map<string, number>();
export function pack(hex: string) {
  let v = packed.get(hex);
  if (v === undefined) {
    const [r, g, b] = hexToRgb(hex);
    v = (255 << 24) | (b << 16) | (g << 8) | r;
    packed.set(hex, v >>> 0);
    v = v >>> 0;
  }
  return v;
}

export class Painter {
  data: Uint32Array;
  constructor(
    public w: number,
    public h: number,
  ) {
    this.data = new Uint32Array(w * h);
  }
  px(x: number, y: number, c: string) {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.data[y * this.w + x] = pack(c);
  }
  rect(x: number, y: number, w: number, h: number, c: string) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, c);
  }
  /** Filled ellipse; `shade` lets callers colour by position. */
  ellipse(cx: number, cy: number, rx: number, ry: number, c: string | ((x: number, y: number) => string | null)) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / (rx + 0.35),
          dy = (y - cy) / (ry + 0.35);
        if (dx * dx + dy * dy > 1) continue;
        const color = typeof c === 'string' ? c : c(x, y);
        if (color) this.px(x, y, color);
      }
  }
  line(x0: number, y0: number, x1: number, y1: number, c: string) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let k = 0; k <= n; k++) this.px(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, c);
  }
  get(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.data[y * this.w + x] : 0;
  }
}

export interface Sprite {
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
  /** ground anchor inside the sprite (bottom centre by default) */
  ax: number;
  ay: number;
  /** footprint radius used for spacing */
  r: number;
  emit: Record<string, [number, number][]>;
}

export function makeSprite(
  w: number,
  h: number,
  paint: (p: Painter) => void,
  options: { outline?: string | null; r?: number; ax?: number; ay?: number; emit?: Record<string, [number, number][]> } = {},
): Sprite {
  const p = new Painter(w, h);
  paint(p);
  const pad = 1,
    W = w + pad * 2,
    H = h + pad * 2;
  const out = new Uint32Array(W * H);
  const outline = options.outline === undefined ? C.outline : options.outline;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[(y + pad) * W + x + pad] = p.data[y * w + x];
  if (outline) {
    const o = pack(outline);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (out[y * W + x]) continue;
        const sx = x - pad,
          sy = y - pad;
        if (p.get(sx - 1, sy) || p.get(sx + 1, sy) || p.get(sx, sy - 1) || p.get(sx, sy + 1)) out[y * W + x] = o;
      }
  }
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(W, H);
  new Uint32Array(image.data.buffer).set(out);
  ctx.putImageData(image, 0, 0);
  const emit: Sprite['emit'] = {};
  for (const [k, list] of Object.entries(options.emit || {})) emit[k] = list.map(([x, y]) => [x + pad, y + pad]);
  return {
    canvas,
    w: W,
    h: H,
    ax: (options.ax ?? Math.floor(w / 2)) + pad,
    ay: (options.ay ?? h - 1) + pad,
    r: options.r ?? Math.ceil(w / 2),
    emit,
  };
}

// ---------- nature ----------
export function pineSprite(variant = 0) {
  const tall = variant % 2 === 0;
  const w = 11,
    h = tall ? 18 : 15;
  return makeSprite(
    w,
    h,
    (p) => {
      const cx = 5;
      p.rect(cx - 1, h - 4, 3, 4, C.trunk);
      p.px(cx + 1, h - 4, C.trunkD);
      p.px(cx + 1, h - 3, C.trunkD);
      const tiers = tall ? [[0, 6, 3], [4, 7, 4], [8, 7, 5]] : [[0, 5, 3], [3, 6, 4], [7, 6, 5]];
      for (const [top, height, half] of tiers)
        for (let r = 0; r < height; r++) {
          const hw = Math.round((half * (r + 1)) / height);
          for (let x = cx - hw; x <= cx + hw; x++) {
            const right = x > cx + (r > height - 3 ? -1 : 0);
            let c = right ? C.pineD : C.pine;
            if (x === cx - hw && r > 0) c = C.pineL;
            if (r === height - 1 && x > cx - hw) c = C.pineD;
            p.px(x, top + r, c);
          }
        }
      p.px(cx - 1, 3, C.pineL);
      p.px(cx - 2, 8, C.pineL);
    },
    { r: 4 },
  );
}

export function treeSprite(variant = 0, fruit?: string) {
  const w = 13,
    h = 15;
  return makeSprite(
    w,
    h,
    (p) => {
      p.rect(5, 9, 3, 6, C.trunk);
      p.rect(7, 9, 1, 6, C.trunkD);
      p.px(4, 14, C.trunk);
      p.px(8, 14, C.trunkD);
      const shade = (x: number, y: number) => {
        const t = (x - 6) * 0.55 + (y - 5) * 0.75;
        if (t > 3.2) return C.leafDD;
        if (t > 1.2) return C.leafD;
        if (t < -3.4) return C.leafL;
        return C.leaf;
      };
      p.ellipse(6, 6, 6, 5, shade);
      p.ellipse(3, 4, 3, 3, shade);
      p.ellipse(9, 4, 3, 3, shade);
      p.ellipse(6, 2, 3, 2, shade);
      for (const [x, y] of [
        [3, 3],
        [5, 1],
        [4, 2],
        [2, 5],
        [7, 3],
      ])
        p.px(x, y, variant % 2 ? C.leafL : '#b8e08a');
      if (fruit) for (const [x, y] of [[4, 6], [8, 5], [6, 8], [9, 8]]) p.px(x, y, fruit);
    },
    { r: 5 },
  );
}

export function bushSprite(flower?: string) {
  return makeSprite(
    9,
    6,
    (p) => {
      p.ellipse(4, 3, 4, 2.6, (x, y) => (x + y > 8 ? C.leafD : y < 2 ? C.leafL : C.leaf));
      if (flower) for (const [x, y] of [[2, 2], [5, 1], [6, 3]]) p.px(x, y, flower);
    },
    { r: 4 },
  );
}

export function rockSprite(big = false) {
  const w = big ? 8 : 6,
    h = big ? 5 : 4;
  return makeSprite(
    w,
    h,
    (p) => {
      p.ellipse((w - 1) / 2, (h - 1) / 2 + 0.3, (w - 1) / 2, (h - 1) / 2, (x, y) =>
        y <= 1 && x < w - 2 ? C.stoneL : x + y > w ? C.stoneD : C.stone,
      );
    },
    { r: 3 },
  );
}

// ---------- buildings ----------
interface HouseOptions {
  w: number;
  wallH: number;
  roofH: number;
  roof: string;
  wall?: string;
  windows?: number;
  chimney?: boolean;
}
/** Paints a front-facing 3/4 cottage into `p` with its top-left at (ox, oy). */
function paintHouse(p: Painter, ox: number, oy: number, o: HouseOptions) {
  const wall = o.wall || C.wall,
    wallD = darken(wall, 0.12),
    wallDD = darken(wall, 0.24);
  const roofL = lighten(o.roof, 0.22),
    roofD = darken(o.roof, 0.18),
    roofDD = darken(o.roof, 0.34);
  const wallTop = oy + o.roofH;
  // walls
  p.rect(ox + 2, wallTop, o.w - 4, o.wallH, wall);
  p.rect(ox + o.w - 5, wallTop, 3, o.wallH, wallD);
  p.rect(ox + 2, wallTop + o.wallH - 1, o.w - 4, 1, wallDD);
  p.rect(ox + 2, wallTop, o.w - 4, 1, wallDD);
  // roof (hipped, seen from the front-top)
  for (let r = 0; r < o.roofH; r++) {
    const inset = Math.floor((o.roofH - 1 - r) / 1.6);
    const y = oy + r;
    let c = o.roof;
    if (r === 0) c = roofL;
    else if (r === o.roofH - 1) c = roofDD;
    else if (r % 3 === 2) c = roofD;
    p.rect(ox + inset, y, o.w - inset * 2, 1, c);
    if (r > 0 && r < o.roofH - 1) {
      p.px(ox + inset, y, roofL);
      p.px(ox + o.w - inset - 1, y, roofD);
    }
  }
  // door
  const cx = ox + Math.floor(o.w / 2);
  const doorTop = wallTop + o.wallH - 5;
  p.rect(cx - 1, doorTop, 3, 5, C.door);
  p.px(cx - 1, doorTop, darken(C.door, 0.2));
  p.px(cx + 1, doorTop, darken(C.door, 0.2));
  p.px(cx + 1, doorTop + 2, '#f3c76d');
  // windows
  const n = o.windows ?? 2;
  const spots = n === 1 ? [ox + 4] : [ox + 4, ox + o.w - 7];
  for (const wx of spots) {
    const wy = wallTop + 2;
    p.rect(wx, wy, 3, 3, C.window);
    p.px(wx, wy, C.windowL);
    p.rect(wx - 0, wy + 3, 3, 1, C.woodD);
  }
  if (o.chimney !== false) {
    const chx = ox + o.w - 7;
    p.rect(chx, oy - 3, 3, 5, '#b9a08a');
    p.rect(chx + 2, oy - 3, 1, 5, '#9a826e');
    p.rect(chx, oy - 3, 3, 1, '#7d6a5a');
  }
}

export type BuildingKind =
  | 'cottage'
  | 'academy'
  | 'workshop'
  | 'radio'
  | 'library'
  | 'observatory'
  | 'treehouse'
  | 'windmill';

const RULES: [RegExp, BuildingKind][] = [
  [/网络|通信|信号|电子|电路|network|signal/i, 'radio'],
  [/数据结构|算法|离散|data|algorithm/i, 'treehouse'],
  [/计算机|编程|程序|软件|代码|系统|数据库|computer|program|code|python|java|c\+\+|software/i, 'workshop'],
  [/数学|代数|几何|微积分|统计|概率|分析|math|calculus|algebra|statistic/i, 'academy'],
  [/物理|天文|化学|力学|光学|生物|physics|chemistry|astro|biology/i, 'observatory'],
  [/英语|语文|文学|语言|外语|日语|法语|历史|哲学|english|literature|language|history|writing/i, 'library'],
  [/经济|管理|会计|金融|市场|商|econom|manage|account|finance/i, 'windmill'],
];
export function buildingKindFor(name: string, seed: number): BuildingKind {
  for (const [rule, kind] of RULES) if (rule.test(name)) return kind;
  return (['cottage', 'windmill', 'library', 'observatory'] as const)[seed % 4];
}
export const BUILDING_LABEL: Record<BuildingKind, string> = {
  cottage: '小木屋',
  academy: '黑板学堂',
  workshop: '电脑工坊',
  radio: '信号塔',
  library: '书屋',
  observatory: '天文台',
  treehouse: '树屋',
  windmill: '风车磨坊',
};

export function buildingSprite(kind: BuildingKind, palette: Palette): Sprite {
  const roof = ROOF[palette];
  switch (kind) {
    case 'academy':
      return makeSprite(
        27,
        24,
        (p) => {
          paintHouse(p, 0, 5, { w: 27, wallH: 10, roofH: 9, roof, windows: 2, chimney: false });
          // bell tower
          p.rect(11, 0, 5, 6, C.wall);
          p.rect(14, 0, 2, 6, C.wallD);
          p.px(13, 2, '#e8c35a');
          p.px(13, 3, '#c79c3c');
          p.rect(10, -1, 7, 1, darken(roof, 0.2));
          // round window
          p.px(13, 9, C.windowL);
          p.px(12, 10, C.window);
          p.px(14, 10, C.window);
        },
        { r: 12, emit: { flag: [[13, -3]] } },
      );
    case 'workshop':
      return makeSprite(
        19,
        19,
        (p) => paintHouse(p, 0, 3, { w: 19, wallH: 8, roofH: 8, roof, windows: 1 }),
        { r: 9, emit: { smoke: [[13, -1]] } },
      );
    case 'radio':
      return makeSprite(
        17,
        17,
        (p) => paintHouse(p, 0, 3, { w: 17, wallH: 7, roofH: 7, roof, windows: 1, chimney: false }),
        { r: 8 },
      );
    case 'library':
      return makeSprite(
        23,
        22,
        (p) => {
          paintHouse(p, 0, 4, { w: 23, wallH: 9, roofH: 9, roof, windows: 2 });
          // dormer
          p.rect(9, 3, 5, 4, C.wall);
          p.rect(10, 4, 3, 2, C.window);
          p.rect(8, 2, 7, 1, darken(roof, 0.25));
        },
        { r: 11, emit: { smoke: [[17, 0]] } },
      );
    case 'observatory':
      return makeSprite(
        21,
        23,
        (p) => {
          const base = 12;
          for (let x = 2; x <= 18; x++) {
            const c = x < 5 ? C.wall : x > 14 ? C.wallDD : x > 11 ? C.wallD : C.wall;
            p.rect(x, base, 1, 11, c);
          }
          p.rect(2, 22, 17, 1, C.wallDD);
          p.rect(9, 17, 3, 6, C.door);
          p.px(11, 19, '#f3c76d');
          p.rect(4, 15, 2, 3, C.window);
          p.rect(15, 15, 2, 3, darken(C.window, 0.15));
          const dome = '#c9d4ee',
            domeL = '#eef2fb',
            domeD = '#9eaccd';
          p.ellipse(10, 12, 9, 9.5, (x, y) => {
            if (y > 12) return null;
            const t = (x - 10) * 0.6 + (y - 6) * 0.4;
            return t < -3.5 ? domeL : t > 2.5 ? domeD : dome;
          });
          p.rect(1, 12, 19, 1, '#8f9cbb');
          p.rect(9, 3, 3, 9, '#4d5a7b');
          p.line(12, 6, 18, 1, '#6c7a99');
          p.line(12, 7, 18, 2, '#56637f');
          p.px(19, 1, C.outline);
        },
        { r: 10, emit: { flag: [[3, 9]] } },
      );
    case 'treehouse':
      return makeSprite(
        29,
        33,
        (p) => {
          p.rect(12, 16, 5, 17, C.trunk);
          p.rect(15, 16, 2, 17, C.trunkD);
          p.rect(10, 31, 9, 2, C.trunk);
          const shade = (x: number, y: number) => {
            const t = (x - 14) * 0.5 + (y - 9) * 0.7;
            return t > 5 ? C.leafDD : t > 2 ? C.leafD : t < -5.5 ? C.leafL : C.leaf;
          };
          p.ellipse(14, 9, 13, 8, shade);
          p.ellipse(7, 7, 6, 5, shade);
          p.ellipse(21, 6, 6, 5, shade);
          p.ellipse(14, 4, 7, 4, shade);
          for (const [x, y] of [[6, 4], [11, 2], [9, 5], [16, 2], [20, 4], [4, 8]]) p.px(x, y, '#bde38f');
          // cabin on the trunk
          paintHouse(p, 6, 12, { w: 15, wallH: 6, roofH: 6, roof, windows: 1, chimney: false });
          p.rect(5, 24, 17, 2, C.wood);
          p.rect(5, 25, 17, 1, C.woodD);
          // ladder
          for (let y = 26; y < 33; y++) {
            p.px(20, y, C.woodD);
            p.px(23, y, C.woodD);
            if (y % 2 === 0) p.rect(21, y, 2, 1, C.wood);
          }
        },
        { r: 12, ay: 32 },
      );
    case 'windmill':
      return makeSprite(
        17,
        26,
        (p) => {
          for (let y = 8; y < 26; y++) {
            const half = 4 + Math.floor((y - 8) / 5);
            for (let x = 8 - half; x <= 8 + half; x++) {
              const c = x > 8 + half - 2 ? C.wallDD : x > 8 ? C.wallD : C.wall;
              p.px(x, y, c);
            }
          }
          for (let y = 12; y < 26; y += 4) p.rect(8 - 3, y, 7, 1, darken(C.wall, 0.08));
          p.rect(7, 21, 3, 5, C.door);
          p.rect(7, 14, 2, 2, C.window);
          for (let r = 0; r < 7; r++) {
            const hw = Math.min(5, 1 + r);
            p.rect(8 - hw, 2 + r, hw * 2 + 1, 1, r === 6 ? darken(roof, 0.3) : r < 2 ? lighten(roof) : roof);
          }
        },
        { r: 7, emit: { sails: [[8, 6]] } },
      );
    default:
      return makeSprite(
        21,
        20,
        (p) => paintHouse(p, 0, 3, { w: 21, wallH: 9, roofH: 8, roof, windows: 2 }),
        { r: 10, emit: { smoke: [[15, -1]] } },
      );
  }
}

// ---------- props ----------
export function chalkboardSprite() {
  return makeSprite(
    12,
    11,
    (p) => {
      p.rect(0, 0, 12, 8, C.wood);
      p.rect(1, 1, 10, 6, '#3f6b57');
      p.rect(1, 6, 10, 1, '#365e4c');
      // ∫ and x²
      p.px(4, 1, '#f4f1e6');
      p.px(3, 2, '#f4f1e6');
      p.px(3, 3, '#f4f1e6');
      p.px(3, 4, '#f4f1e6');
      p.px(2, 5, '#f4f1e6');
      for (const [x, y] of [[6, 3], [7, 4], [6, 4], [7, 3], [8, 2], [9, 2], [9, 3]]) p.px(x, y, '#dce9df');
      p.rect(2, 8, 1, 3, C.woodD);
      p.rect(9, 8, 1, 3, C.woodD);
    },
    { r: 5 },
  );
}
export function monitorSprite() {
  return makeSprite(
    15,
    15,
    (p) => {
      p.rect(0, 0, 15, 11, '#efe5cc');
      p.rect(12, 0, 3, 11, '#d7c9a8');
      p.rect(0, 10, 15, 1, '#c3b48f');
      p.rect(2, 2, 10, 7, '#3d7fb8');
      p.rect(2, 2, 10, 1, '#5aa0d6');
      p.rect(3, 4, 5, 1, '#bfe6ff');
      p.rect(3, 6, 7, 1, '#8cc8f2');
      p.px(9, 4, '#ffe39a');
      p.rect(6, 11, 3, 2, '#c3b48f');
      p.rect(1, 13, 13, 2, '#e7dcc2');
      for (let x = 2; x < 13; x += 2) p.px(x, 13, '#b6a888');
    },
    { r: 7 },
  );
}
export function towerSprite() {
  return makeSprite(
    13,
    28,
    (p) => {
      const top = 9;
      p.line(2, 27, 6, top, '#7f8996');
      p.line(10, 27, 6, top, '#6b7480');
      for (let y = top + 4; y < 27; y += 4) {
        const hw = Math.round(((y - top) / (27 - top)) * 4);
        p.line(6 - hw, y, 6 + hw, y, '#8f99a6');
      }
      p.ellipse(6, 5, 5, 5, (x, y) => (x + y > 13 ? '#b9c2cc' : x + y < 8 ? '#ffffff' : '#e5eaee'));
      p.ellipse(6, 5, 2, 2, '#9aa5b2');
      p.px(6, 5, '#56606c');
    },
    { r: 5, emit: { blink: [[6, -1]] } },
  );
}
export function booksSprite() {
  return makeSprite(
    9,
    9,
    (p) => {
      const books: [number, number, string][] = [
        [0, 7, '#7b9fd1'],
        [1, 5, '#e48a74'],
        [0, 3, '#f0c75e'],
        [2, 1, '#9b8bd0'],
      ];
      for (const [x, y, c] of books) {
        p.rect(x, y, 7, 2, c);
        p.rect(x, y + 1, 7, 1, darken(c, 0.2));
        p.px(x + 6, y, '#fffaf0');
      }
      p.rect(2, 0, 4, 1, '#9b8bd0');
    },
    { r: 4 },
  );
}
export function signSprite() {
  return makeSprite(
    11,
    11,
    (p) => {
      p.rect(4, 6, 2, 5, C.woodD);
      p.rect(0, 0, 11, 7, C.wood);
      p.rect(0, 0, 11, 1, C.woodL);
      p.rect(0, 6, 11, 1, C.woodD);
      p.rect(5, 1, 1, 5, '#6d4b2f');
      p.rect(3, 3, 5, 1, '#6d4b2f');
    },
    { r: 4 },
  );
}
export function flagPoleSprite() {
  return makeSprite(3, 13, (p) => {
    p.rect(1, 0, 1, 13, '#8a7a68');
    p.px(1, 0, '#e8c35a');
    p.rect(0, 12, 3, 1, '#8a7a68');
  }, { r: 1, ax: 1, emit: { flag: [[2, 1]] } });
}
export function bedSprite(level: number, palette: Palette) {
  const w = 9,
    h = 6;
  return makeSprite(
    w,
    h,
    (p) => {
      p.rect(0, 1, w, h - 1, C.woodD);
      p.rect(1, 1, w - 2, h - 2, C.soilD);
      for (let x = 1; x < w - 1; x++) if (x % 2) p.rect(x, 2, 1, h - 3, C.soilDD);
      for (let i = 0; i < 4; i++) {
        const x = 1 + i * 2,
          y = 3;
        if (level === 0) p.px(x, y, '#8fb06a');
        else if (level === 1) {
          p.px(x, y, C.leaf);
          p.px(x, y - 1, C.leafL);
        } else if (level === 2) {
          p.px(x, y, C.leafD);
          p.px(x, y - 1, C.leaf);
          p.px(x, y - 2, C.leafL);
        } else {
          p.px(x, y, C.leafD);
          p.px(x, y - 1, C.leaf);
          p.px(x, y - 2, i % 2 ? ROOF[palette] : '#f6d66a');
        }
      }
    },
    { r: 5 },
  );
}
export function lighthouseSprite() {
  return makeSprite(
    15,
    34,
    (p) => {
      p.ellipse(7, 31, 7, 2.6, (x, y) => (y < 31 ? C.stoneL : x > 9 ? C.stoneD : C.stone));
      for (let y = 10; y <= 30; y++) {
        const half = 3 + Math.round(((y - 10) / 20) * 2.4);
        for (let x = 7 - half; x <= 7 + half; x++) {
          const band = (y >= 13 && y <= 15) || (y >= 21 && y <= 23);
          let c = band ? C.red : C.white;
          if (x >= 7 + half - 1) c = band ? C.redD : '#e2d9c6';
          else if (x === 7 - half) c = band ? '#ee9a85' : '#ffffff';
          p.px(x, y, c);
        }
      }
      p.rect(6, 26, 3, 5, C.door);
      p.rect(7, 17, 1, 2, '#5d6b78');
      p.rect(2, 9, 11, 1, '#55606b');
      for (let x = 2; x <= 12; x += 2) p.px(x, 8, '#55606b');
      p.rect(4, 4, 7, 4, '#fff1a8');
      p.px(4, 4, '#ffffff');
      p.rect(6, 4, 1, 4, '#6f7a85');
      p.rect(9, 4, 1, 4, '#6f7a85');
      for (let r = 0; r < 4; r++) p.rect(7 - (r + 1), r, (r + 1) * 2 + 1, 1, r < 1 ? '#ee9a85' : C.red);
      p.px(7, -1, '#e8c35a');
    },
    { r: 7, emit: { lamp: [[7, 5]] } },
  );
}
export function boatSprite() {
  return makeSprite(
    12,
    9,
    (p) => {
      p.rect(0, 5, 12, 2, '#b9855a');
      p.rect(1, 7, 10, 1, '#8d6141');
      p.rect(0, 5, 12, 1, '#d8a676');
      p.line(5, 0, 5, 4, '#7d6a5a');
      for (let r = 0; r < 4; r++) p.rect(6, r + 1, r + 1, 1, r === 3 ? '#e9e1cf' : C.white);
    },
    { r: 6 },
  );
}

const spriteCache = new Map<string, Sprite>();
export function cached(key: string, make: () => Sprite) {
  let s = spriteCache.get(key);
  if (!s) {
    s = make();
    spriteCache.set(key, s);
  }
  return s;
}
