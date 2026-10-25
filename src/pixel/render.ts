import type { Course, Palette } from '../../shared/types';
import { ISLET, PATH, WATER, distanceField, fbm, hash2, rng, type World } from './world';
import {
  C,
  ROOF,
  bedSprite,
  boatSprite,
  booksSprite,
  buildingKindFor,
  buildingSprite,
  bushSprite,
  cached,
  chalkboardSprite,
  darken,
  flagPoleSprite,
  lighthouseSprite,
  monitorSprite,
  pack,
  pineSprite,
  rockSprite,
  signSprite,
  towerSprite,
  treeSprite,
  type Sprite,
} from './sprites';

export const REGISTRY = 7;
const DECOR = 8;
export interface KeepOut {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface Anchor {
  kind: 'course' | 'empty' | 'registry';
  slot: number;
  x: number;
  y: number;
  course?: Course;
}
interface Placed {
  sprite: Sprite;
  x: number;
  y: number;
  shadow?: boolean;
}
interface Flag {
  x: number;
  y: number;
  color: string;
}
export interface Scene {
  lw: number;
  lh: number;
  ox: number;
  oy: number;
  world: World;
  base: Uint32Array;
  foam: number[];
  rings: number[][];
  glints: number[];
  smoke: [number, number][];
  flags: Flag[];
  blinks: [number, number][];
  lamps: [number, number][];
  sails: [number, number, string][];
  mist: [number, number][];
  boat: { x: number; y: number; data: Uint32Array; w: number; h: number } | null;
  hover: Map<number, number[]>;
  anchors: Anchor[];
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.47;

export function hashString(text: string) {
  let h = 2166136261;
  for (const ch of text) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function unpack(v: number) {
  return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255];
}
function blendPacked(dst: number, hex: string, a: number) {
  const [r, g, b] = unpack(dst),
    [R, G, B] = unpack(pack(hex));
  return (
    ((255 << 24) |
      (Math.round(b + (B - b) * a) << 16) |
      (Math.round(g + (G - g) * a) << 8) |
      Math.round(r + (R - r) * a)) >>>
    0
  );
}

function spritePixels(sprite: Sprite) {
  const ctx = sprite.canvas.getContext('2d')!;
  return new Uint32Array(ctx.getImageData(0, 0, sprite.w, sprite.h).data.buffer.slice(0));
}

export function buildScene(
  world: World,
  courses: Course[],
  lw: number,
  lh: number,
  ox: number,
  oy: number,
  keepOut: KeepOut[] = [],
): Scene {
  const N = lw * lh;
  const W = world.w,
    H = world.h;
  const cellAt = (x: number, y: number) => {
    const wx = x - ox,
      wy = y - oy;
    if (wx < 0 || wy < 0 || wx >= W || wy >= H) return WATER;
    return world.cell[wy * W + wx];
  };
  const innerAt = (wx: number, wy: number) =>
    wx < 0 || wy < 0 || wx >= W || wy >= H ? 0 : world.inner[wy * W + wx];
  const bySlot = new Map(courses.map((course) => [course.slotId, course]));

  // ---- elevation ----
  const cell = new Int8Array(N);
  const cliff = new Uint8Array(N);
  for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) cell[y * lw + x] = cellAt(x, y);
  // decorative islets scattered in open water
  const islets: { x: number; y: number; rx: number; ry: number }[] = [];
  {
    const near = distanceField(lw, lh, (i) => cell[i] !== WATER, 80);
    const random = rng(world.seed + 313);
    const target = Math.max(3, Math.min(7, Math.round((lw * lh) / 9000)));
    for (let attempt = 0; attempt < 600 && islets.length < target; attempt++) {
      const x = 10 + Math.floor(random() * (lw - 20)),
        y = 10 + Math.floor(random() * (lh - 20));
      const rx = 3.5 + random() * 4.5,
        ry = rx * (0.55 + random() * 0.2);
      const d = near[y * lw + x];
      if (d < rx + 13 || d > 70) continue;
      if (islets.some((o) => Math.hypot(o.x - x, o.y - y) < o.rx + rx + 16)) continue;
      if (keepOut.some((k) => x + rx + 6 > k.x0 && x - rx - 6 < k.x1 && y + ry + 8 > k.y0 && y - ry - 6 < k.y1)) continue;
      islets.push({ x, y, rx, ry });
    }
    for (const o of islets)
      for (let y = Math.floor(o.y - o.ry - 2); y <= o.y + o.ry + 2; y++)
        for (let x = Math.floor(o.x - o.rx - 2); x <= o.x + o.rx + 2; x++) {
          if (x < 0 || y < 0 || x >= lw || y >= lh) continue;
          const wobble = (fbm(x * 0.3, y * 0.3, world.seed + 57) - 0.5) * 0.5;
          if (((x - o.x) / o.rx) ** 2 + ((y - o.y) / o.ry) ** 2 < 1 + wobble) cell[y * lw + x] = DECOR;
        }
  }
  for (let x = 0; x < lw; x++) {
    let lastLand = -100,
      height = 4;
    for (let y = 0; y < lh; y++) {
      const c = cell[y * lw + x];
      if (c !== WATER) {
        lastLand = y;
        height = c === ISLET ? 3 : c === DECOR ? 2 : 4;
      } else if (y - lastLand <= height) cliff[y * lw + x] = y - lastLand;
    }
  }
  const foot = (i: number) => cell[i] !== WATER || cliff[i] > 0;
  const D = distanceField(lw, lh, foot, 60);
  const beach = (i: number) => !foot(i) && D[i] <= 3.1;
  const D2 = distanceField(lw, lh, (i) => foot(i) || beach(i), 90);

  const buf = new Uint32Array(N);
  const seed = world.seed;
  for (let y = 0; y < lh; y++)
    for (let x = 0; x < lw; x++) {
      const i = y * lw + x;
      const c = cell[i];
      const hsh = hash2(x - ox, y - oy, seed);
      let color: string;
      if (c === WATER && cliff[i]) {
        const k = cliff[i],
          max = cell[(y - k) * lw + x] === ISLET ? 3 : cell[(y - k) * lw + x] === DECOR ? 2 : 4;
        if (k === 1) color = C.grassDD;
        else if (k === max) color = C.cliffDD;
        else {
          const strata = fbm((x - ox) * 0.25, (y - oy) * 1.2, seed + 7);
          color = strata > 0.6 ? C.cliffL : strata < 0.38 ? C.cliffD : C.cliff;
          const left = x > 0 && cell[i - 1] === WATER && !cliff[i - 1];
          if (left) color = C.cliffL;
        }
      } else if (c === WATER) {
        if (D[i] <= 3.1) {
          const under = y > 0 && (cliff[i - lw] || cell[i - lw] !== WATER);
          color = D[i] > 2.3 ? C.wetSand : under && D[i] < 1.5 ? C.sandD : C.sand;
          if (hsh < 0.05) color = C.sandL;
          else if (hsh > 0.95) color = C.sandD;
        } else {
          const v = D2[i] + bayer(x, y) * 2.4;
          color = v < 2.2 ? C.shallow2 : v < 6 ? C.shallow : v < 12 ? C.mid : v < 30 ? C.deep : C.deep2;
          if (v >= 12 && fbm(x * 0.06, y * 0.35, seed + 41) > 0.7) color = v < 30 ? C.mid : C.deep;
        }
      } else if (c === PATH) {
        const edge =
          cell[i - 1] !== PATH || cell[i + 1] !== PATH || cell[i - lw] !== PATH || cell[i + lw] !== PATH;
        color = edge ? C.pathD : hsh < 0.08 ? C.pathD : hsh > 0.9 ? C.pathL : C.path;
      } else {
        const registered = c === ISLET || c === DECOR || bySlot.has(c);
        const wx = x - ox,
          wy = y - oy;
        if (registered) {
          const t = fbm(wx * 0.09, wy * 0.09, seed + 3) + bayer(x, y) * 0.14;
          color = t > 0.62 ? C.grassL : t < 0.37 ? C.grassD : C.grass;
          if (cell[i - lw] === WATER) color = C.grassLL;
          else if (cell[i - 1] === WATER) color = C.grassL;
          else if (cell[i - lw] === PATH) color = C.grassD;
        } else {
          const inner = innerAt(wx, wy);
          const rim = 4.5 + (fbm(wx * 0.15, wy * 0.15, seed + 13) - 0.5) * 3;
          if (inner < rim) {
            // wild grass fringe along coast and paths
            const t = fbm(wx * 0.1, wy * 0.1, seed + 3) + bayer(x, y) * 0.14;
            color = t > 0.6 ? C.grassL : t < 0.4 ? C.grassDD : C.grassD;
            if (cell[i - lw] === WATER) color = C.grassL;
            else if (cell[i - lw] === PATH) color = C.grassDD;
          } else {
            const furrow = (wy + Math.floor(wx / 9)) % 3 === 0;
            const t = fbm(wx * 0.12, wy * 0.12, seed + 9) + bayer(x, y) * 0.12;
            color = furrow ? C.soilD : t > 0.62 ? C.soilL : C.soil;
            if (inner < rim + 1) color = C.soilDD;
          }
        }
      }
      buf[i] = pack(color);
    }

  // ---- bridge & dock (painted into terrain) ----
  const put = (x: number, y: number, color: string) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < lw && y < lh) buf[y * lw + x] = pack(color);
  };
  const shade = (x: number, y: number, a: number) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < lw && y < lh) buf[y * lw + x] = blendPacked(buf[y * lw + x], '#24414a', a);
  };
  {
    const b = world.bridge;
    const len = Math.hypot(b.x1 - b.x0, b.y1 - b.y0),
      ux = (b.x1 - b.x0) / len,
      uy = (b.y1 - b.y0) / len,
      px = -uy,
      py = ux;
    for (let s = 0; s <= len; s += 0.5)
      for (let k = -2; k <= 2; k += 0.5) {
        const x = ox + b.x0 + ux * s + px * k,
          y = oy + b.y0 + uy * s + py * k;
        if (cellAt(Math.round(x), Math.round(y)) !== WATER) continue;
        shade(x, y + 3, 0.18);
      }
    for (let s = 0; s <= len; s += 0.5)
      for (let k = -2; k <= 2; k += 0.5) {
        const x = ox + b.x0 + ux * s + px * k,
          y = oy + b.y0 + uy * s + py * k;
        if (cellAt(Math.round(x), Math.round(y)) !== WATER) continue;
        const edge = Math.abs(k) >= 2;
        put(x, y, edge ? C.woodD : Math.floor(s) % 2 ? C.wood : C.woodL);
      }
  }
  const dx = ox + world.dock.x,
    dy = oy + world.dock.y;
  for (let y = dy + 1; y <= dy + 14; y++) {
    for (let x = dx - 2; x <= dx + 2; x++) {
      shade(x + 1, y + 2, 0.16);
    }
  }
  for (let y = dy + 1; y <= dy + 14; y++)
    for (let x = dx - 2; x <= dx + 2; x++) {
      const edge = x === dx - 2 || x === dx + 2;
      put(x, y, edge ? C.woodD : y % 2 ? C.wood : C.woodL);
    }
  put(dx - 2, dy + 15, C.woodD);
  put(dx + 2, dy + 15, C.woodD);

  // ---- placement ----
  const placed: Placed[] = [];
  const anchors: Anchor[] = [];
  const smoke: [number, number][] = [],
    flags: Flag[] = [],
    blinks: [number, number][] = [],
    lamps: [number, number][] = [],
    sails: [number, number, string][] = [],
    mist: [number, number][] = [];
  const pixelDecor: [number, number, string][] = [];

  function addEmitters(sprite: Sprite, x: number, y: number, palette: Palette) {
    const left = x - sprite.ax,
      top = y - sprite.ay;
    for (const [ex, ey] of sprite.emit.smoke || []) smoke.push([left + ex, top + ey]);
    for (const [ex, ey] of sprite.emit.flag || []) flags.push({ x: left + ex, y: top + ey, color: ROOF[palette] });
    for (const [ex, ey] of sprite.emit.blink || []) blinks.push([left + ex, top + ey]);
    for (const [ex, ey] of sprite.emit.lamp || []) lamps.push([left + ex, top + ey]);
    for (const [ex, ey] of sprite.emit.sails || []) sails.push([left + ex, top + ey, ROOF[palette]]);
  }

  for (const plot of world.plots) {
    const course = bySlot.get(plot.slot);
    const random = rng(seed + plot.slot * 101 + (course ? hashString(course.id) : 0));
    const occupied: { x: number; y: number; r: number }[] = [];
    const fits = (wx: number, wy: number, r: number) => {
      wx = Math.round(wx);
      wy = Math.round(wy);
      if (wx < 0 || wy < 0 || wx >= W || wy >= H) return false;
      if (world.cell[wy * W + wx] !== plot.slot || world.inner[wy * W + wx] < r) return false;
      return occupied.every((o) => Math.hypot(o.x - wx, (o.y - wy) * 1.3) >= o.r + r + 1);
    };
    const place = (sprite: Sprite, wx: number, wy: number, shadow = true) => {
      occupied.push({ x: Math.round(wx), y: Math.round(wy), r: sprite.r });
      placed.push({ sprite, x: Math.round(wx) + ox, y: Math.round(wy) + oy, shadow });
    };
    const { pole } = plot;
    if (!course) {
      const sign = cached('sign', signSprite);
      place(sign, pole.x, pole.y, true);
      for (let n = 0; n < 7; n++) {
        const a = random() * Math.PI * 2,
          d = 8 + random() * 18;
        const wx = Math.round(pole.x + Math.cos(a) * d * 1.3),
          wy = Math.round(pole.y + Math.sin(a) * d * 0.8);
        if (fits(wx, wy, 2)) pixelDecor.push([wx + ox, wy + oy, random() < 0.5 ? C.soilDD : C.stone]);
      }
      if (fits(pole.x + 16, pole.y + 9, 3)) place(cached('rock0', () => rockSprite(false)), pole.x + 16, pole.y + 9);
      for (let wy = 1; wy < H - 1; wy++)
        for (let wx = 1; wx < W - 1; wx++) {
          const wi = wy * W + wx;
          if (world.cell[wi] !== plot.slot) continue;
          const d = world.inner[wi];
          const rim = 4.5 + (fbm(wx * 0.15, wy * 0.15, seed + 13) - 0.5) * 3;
          if (d >= rim + 1 && d < rim + 2 && (wx * 7 + wy * 13) % 11 === 0) {
            pixelDecor.push([wx + ox, wy + oy - 1, C.woodL], [wx + ox, wy + oy, C.woodD]);
          }
        }
      anchors.push({ kind: 'empty', slot: plot.slot, x: pole.x + ox, y: pole.y + oy + 4 });
      continue;
    }
    const kind = buildingKindFor(course.name, hashString(course.id));
    const building = cached(`b:${kind}:${course.palette}`, () => buildingSprite(kind, course.palette));
    let bx = pole.x,
      by = pole.y + Math.round(building.h * 0.22);
    if (world.cell[by * W + bx] !== plot.slot) by = pole.y;
    place(building, bx, by);
    occupied[occupied.length - 1].y -= 2;
    addEmitters(building, bx + ox, by + oy, course.palette);
    const accessory =
      kind === 'academy'
        ? cached('chalk', chalkboardSprite)
        : kind === 'workshop'
          ? cached('monitor', monitorSprite)
          : kind === 'radio'
            ? cached('tower', towerSprite)
            : kind === 'library'
              ? cached('books', booksSprite)
              : null;
    if (accessory) {
      const gap = building.r + accessory.r + 1;
      for (const [ax, ay] of [
        [gap, 1],
        [-gap, 1],
        [gap, 5],
        [-gap, 5],
        [gap + 3, -2],
        [-gap - 3, -2],
      ])
        if (fits(bx + ax, by + ay, accessory.r)) {
          place(accessory, bx + ax, by + ay);
          addEmitters(accessory, bx + ax + ox, by + ay + oy, course.palette);
          break;
        }
    }
    if (!building.emit.flag) {
      const pole2 = cached('flagpole', flagPoleSprite);
      for (const [fx, fy] of [
        [-building.r - 3, -1],
        [building.r + 3, -1],
        [-building.r - 6, 3],
        [building.r + 6, 3],
      ])
        if (fits(bx + fx, by + fy, 2)) {
          place(pole2, bx + fx, by + fy, false);
          addEmitters(pole2, bx + fx + ox, by + fy + oy, course.palette);
          break;
        }
    }
    // knowledge beds: one per region
    const regions = [...course.regions].sort((a, b) => a.groupIndex - b.groupIndex).slice(0, 8);
    const angles = [95, 70, 120, 45, 145, 20, 165, -5, 190, 345, 215, 320];
    let placedBeds = 0;
    for (const region of regions) {
      const bed = cached(`bed:${Math.min(region.level, 3)}:${course.palette}`, () =>
        bedSprite(Math.min(region.level, 3), course.palette),
      );
      let done = false;
      for (const dist of [building.r + 8, building.r + 14, building.r + 20]) {
        for (const deg of angles) {
          const a = (deg * Math.PI) / 180;
          const wx = bx + Math.cos(a) * dist * 1.25,
            wy = by - 2 + Math.sin(a) * dist * 0.75;
          if (fits(wx, wy, bed.r)) {
            place(bed, wx, wy, false);
            if (region.due) mist.push([Math.round(wx) + ox, Math.round(wy) + oy - 3]);
            done = true;
            placedBeds++;
            break;
          }
        }
        if (done) break;
      }
    }
    const progress = course.pointCount
      ? (course.masteredCount + course.developingCount * 0.45) / course.pointCount
      : 0;
    const trees = 5 + (course.documentCount ? 2 : 0) + Math.round(progress * 9);
    const flowerColors = ['#ffffff', '#f6d66a', '#f2a0b5', '#c4a8f0', ROOF[course.palette]];
    let made = 0;
    for (let attempt = 0; attempt < 500 && made < trees; attempt++) {
      const a = random() * Math.PI * 2,
        d = 10 + random() * 40;
      const wx = plot.cx + Math.cos(a) * d * 1.2,
        wy = plot.cy + Math.sin(a) * d * 0.85;
      const edgeBias = Math.round(wx) >= 0 && Math.round(wy) >= 0 && Math.round(wx) < W && Math.round(wy) < H
        ? world.inner[Math.round(wy) * W + Math.round(wx)]
        : 0;
      if (edgeBias > 11 && random() < 0.75) continue;
      if (Math.hypot(wx - bx, (wy - by) * 1.3) < building.r + 9) continue;
      const pine = random() < 0.45;
      const sprite = pine
        ? cached(`pine${made % 2}`, () => pineSprite(made % 2))
        : progress > 0.55 && random() < 0.35
          ? cached('fruit', () => treeSprite(1, '#f08a6b'))
          : cached(`tree${made % 2}`, () => treeSprite(made % 2));
      if (fits(wx, wy, sprite.r)) {
        place(sprite, wx, wy);
        made++;
      }
    }
    const bushes = 3 + Math.round(progress * 4);
    for (let n = 0, attempt = 0; n < bushes && attempt < 200; attempt++) {
      const wx = plot.cx + (random() - 0.5) * 80,
        wy = plot.cy + (random() - 0.5) * 60;
      const flower = progress > 0.3 && random() < 0.5 ? flowerColors[n % flowerColors.length] : undefined;
      const sprite = cached(`bush:${flower || ''}`, () => bushSprite(flower));
      if (fits(wx, wy, sprite.r)) {
        place(sprite, wx, wy);
        n++;
      }
    }
    if (fits(plot.cx + 22, plot.cy + 14, 3)) place(cached('rock1', () => rockSprite(true)), plot.cx + 22, plot.cy + 14);
    const flowers = 10 + Math.round(progress * 46);
    for (let n = 0, attempt = 0; n < flowers && attempt < 600; attempt++) {
      const wx = Math.round(plot.cx + (random() - 0.5) * 90),
        wy = Math.round(plot.cy + (random() - 0.5) * 70);
      if (!fits(wx, wy, 1.5)) continue;
      pixelDecor.push([wx + ox, wy + oy, flowerColors[Math.floor(random() * flowerColors.length)]]);
      pixelDecor.push([wx + ox, wy + oy + 1, C.grassDD]);
      n++;
    }
    for (let n = 0, attempt = 0; n < 18 && attempt < 300; attempt++) {
      const wx = Math.round(plot.cx + (random() - 0.5) * 90),
        wy = Math.round(plot.cy + (random() - 0.5) * 70);
      if (!fits(wx, wy, 1.5)) continue;
      pixelDecor.push([wx + ox - 1, wy + oy - 1, C.grassDD], [wx + ox, wy + oy, C.grassDD], [wx + ox + 1, wy + oy - 1, C.grassDD]);
      n++;
    }
    anchors.push({ kind: 'course', slot: plot.slot, x: bx + ox, y: by + oy + 3, course });
  }

  // islet + lighthouse
  {
    const lh2 = cached('lighthouse', lighthouseSprite);
    const x = world.islet.x + ox,
      y = world.islet.y + oy + 3;
    placed.push({ sprite: lh2, x, y, shadow: true });
    addEmitters(lh2, x, y, 'apricot');
    placed.push({ sprite: cached('rock0', () => rockSprite(false)), x: x + 8, y: y + 3, shadow: true });
    placed.push({ sprite: cached('bush:', () => bushSprite()), x: x - 8, y: y + 2, shadow: true });
    anchors.push({ kind: 'registry', slot: REGISTRY, x, y: y + 8 });
  }
  // dress the small islets
  {
    const random = rng(world.seed + 911);
    for (const o of islets) {
      const pick = random();
      const big = o.rx > 5.5;
      if (big) {
        const tree = pick < 0.5 ? cached('pine0', () => pineSprite(0)) : cached('tree0', () => treeSprite(0));
        placed.push({ sprite: tree, x: Math.round(o.x - 1), y: Math.round(o.y + 1), shadow: true });
        if (random() < 0.6) placed.push({ sprite: cached('bush:', () => bushSprite()), x: Math.round(o.x + o.rx * 0.5), y: Math.round(o.y + 1), shadow: true });
      } else if (pick < 0.45) {
        placed.push({ sprite: cached('bush:#f2a0b5', () => bushSprite('#f2a0b5')), x: Math.round(o.x), y: Math.round(o.y + 1), shadow: true });
      } else if (pick < 0.75) {
        placed.push({ sprite: cached('rock1', () => rockSprite(true)), x: Math.round(o.x), y: Math.round(o.y + 1), shadow: true });
      } else {
        placed.push({ sprite: cached('pine1', () => pineSprite(1)), x: Math.round(o.x), y: Math.round(o.y + 1), shadow: true });
      }
      for (let n = 0; n < 3; n++) {
        const fx = Math.round(o.x + (random() - 0.5) * o.rx * 1.4),
          fy = Math.round(o.y + (random() - 0.5) * o.ry * 1.2);
        if (cell[fy * lw + fx] === DECOR) pixelDecor.push([fx, fy, n % 2 ? '#ffffff' : '#f6d66a']);
      }
    }
  }
  // rocks at sea
  {
    const random = rng(seed + 77);
    const rock = cached('rock1', () => rockSprite(true));
    for (let n = 0, attempt = 0; n < 6 && attempt < 400; attempt++) {
      const x = Math.floor(random() * lw),
        y = Math.floor(random() * lh);
      const i = y * lw + x;
      if (D2[i] < 7 || D2[i] > 26 || x < 6 || y < 6 || x > lw - 6 || y > lh - 6) continue;
      for (let k = -4; k <= 4; k++) put(x + k, y + 1, Math.abs(k) > 3 ? C.shallow : C.shallow2);
      placed.push({ sprite: rock, x, y, shadow: false });
      n++;
    }
  }

  // shadows (into terrain buffer, before sprites)
  for (const item of placed) {
    if (!item.shadow) continue;
    const r = Math.max(2, item.sprite.r),
      ry = Math.max(1, Math.round(r * 0.38));
    for (let yy = -ry; yy <= ry; yy++)
      for (let xx = -r; xx <= r; xx++)
        if ((xx * xx) / (r * r) + (yy * yy) / (ry * ry) <= 1) shade(item.x + xx + 1, item.y + yy + 1, 0.2);
  }
  for (const [x, y, c] of pixelDecor) put(x, y, c);

  // compose sprites
  const canvas = document.createElement('canvas');
  canvas.width = lw;
  canvas.height = lh;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(lw, lh);
  new Uint32Array(image.data.buffer).set(buf);
  ctx.putImageData(image, 0, 0);
  placed.sort((a, b) => a.y - b.y);
  for (const item of placed) ctx.drawImage(item.sprite.canvas, item.x - item.sprite.ax, item.y - item.sprite.ay);
  const base = new Uint32Array(ctx.getImageData(0, 0, lw, lh).data.buffer.slice(0));

  // animation inputs
  const foam: number[] = [],
    rings: number[][] = Array.from({ length: 9 }, () => []),
    glintPool: number[] = [];
  for (let i = 0; i < N; i++) {
    if (foot(i) || beach(i)) continue;
    const d = D2[i];
    if (d <= 1.5) foam.push(i);
    else if (d < 9) rings[Math.floor(d)].push(i);
    else if (d > 11 && hash2(i, 3, seed) < 0.02) glintPool.push(i);
  }
  const boat = boatSprite();
  const hover = new Map<number, number[]>();
  for (const plot of world.plots)
    hover.set(
      plot.slot,
      plot.boundary.map((wi) => (Math.floor(wi / W) + oy) * lw + (wi % W) + ox),
    );
  const islet: number[] = [];
  for (let y = 1; y < lh - 1; y++)
    for (let x = 1; x < lw - 1; x++) {
      const i = y * lw + x;
      if (cell[i] === ISLET && (cell[i - 1] !== ISLET || cell[i + 1] !== ISLET || cell[i - lw] !== ISLET || cell[i + lw] !== ISLET))
        islet.push(i);
    }
  hover.set(REGISTRY, islet);
  return {
    lw,
    lh,
    ox,
    oy,
    world,
    base,
    foam,
    rings,
    glints: glintPool,
    smoke,
    flags,
    blinks,
    lamps,
    sails,
    mist,
    boat: { x: dx + 4, y: dy + 13, data: spritePixels(boat), w: boat.w, h: boat.h },
    hover,
    anchors,
  };
}

export function drawFrame(ctx: CanvasRenderingContext2D, scene: Scene, frame: Uint32Array, image: ImageData, t: number, hover: number | null) {
  const { lw, lh } = scene;
  frame.set(scene.base);
  const set = (x: number, y: number, color: string, a = 1) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= lw || y >= lh) return;
    const i = y * lw + x;
    frame[i] = a >= 1 ? pack(color) : blendPacked(frame[i], color, a);
  };
  const seed = scene.world.seed;
  // shore foam shimmer
  for (const i of scene.foam) {
    const v = Math.sin(t * 1.7 + hash2(i, 1, seed) * 6.28);
    if (v > -0.1) frame[i] = pack(v > 0.55 ? C.foam : C.shallow2);
  }
  // wave laps moving toward the beach
  for (let wave = 0; wave < 2; wave++) {
    const phase = (t / 3.2 + wave * 0.5) % 1;
    const ring = Math.floor(8.8 - phase * 7.5);
    const list = scene.rings[ring] || [];
    for (const i of list) if (hash2(i, 2, seed) < 0.75 - phase * 0.35) frame[i] = pack(ring <= 3 ? C.foam : C.shallow2);
  }
  // sea glints
  const pool = scene.glints;
  if (pool.length)
    for (let g = 0; g < 16; g++) {
      const period = 2.6 + (g % 5) * 0.4;
      const local = (t / period + g * 0.137) % 1;
      if (local > 0.32) continue;
      const cycle = Math.floor(t / period + g * 0.137);
      const i = pool[Math.floor(hash2(cycle, g, seed) * pool.length)];
      const len = 1 + Math.round(Math.sin((local / 0.32) * Math.PI) * 2);
      const x = i % lw,
        y = Math.floor(i / lw);
      for (let k = -len; k <= len; k++) set(x + k, y, k === 0 ? C.foam : C.shallow2);
    }
  // lighthouse beam + lamp glow
  for (const [lx, ly] of scene.lamps) {
    const a = t * 0.9;
    const ux = Math.cos(a),
      uy = Math.sin(a) * 0.45;
    for (let s = 3; s < 50; s++) {
      const width = s * 0.2;
      for (let k = -width; k <= width; k += 1) {
        const x = lx + ux * s - uy * k * 2,
          y = ly + uy * s + ux * k * 0.5;
        set(x, y, '#fff6c8', 0.26 * (1 - s / 50) * (0.6 + 0.4 * Math.abs(ux)));
      }
    }
    const glow = 0.5 + 0.3 * Math.sin(t * 3);
    for (let yy = -2; yy <= 2; yy++)
      for (let xx = -3; xx <= 3; xx++) if (Math.abs(xx) + Math.abs(yy) <= 3) set(lx + xx, ly + yy, '#fff3a6', glow * 0.6);
  }
  // chimney smoke
  for (const [sx, sy] of scene.smoke)
    for (let p = 0; p < 3; p++) {
      const age = (t * 0.35 + p / 3 + (sx % 7) * 0.05) % 1;
      const x = sx + Math.sin(age * 5 + p) * 1.2 + age * 4,
        y = sy - age * 13;
      const a = (1 - age) * 0.85;
      set(x, y, '#f8f5ee', a);
      if (age < 0.55) {
        set(x + 1, y, '#f8f5ee', a);
        set(x, y - 1, '#f8f5ee', a);
        set(x + 1, y - 1, '#e8e2d6', a);
      }
    }
  // flags
  for (const f of scene.flags) {
    const wave = Math.floor(t * 3 + f.x) % 2;
    for (let yy = 0; yy < 5; yy++) set(f.x - 1, f.y - 5 + yy, '#8a7a68');
    for (let yy = 0; yy < 3; yy++)
      for (let xx = 0; xx < 5; xx++) {
        const dy = xx >= 3 && wave ? 1 : 0;
        set(f.x + xx, f.y - 5 + yy + dy, yy === 2 ? darken(f.color, 0.2) : f.color);
      }
    set(f.x + 1, f.y - 5, '#ffffff', 0.35);
  }
  // radio blink
  for (const [bx, by] of scene.blinks) if (Math.floor(t * 1.6) % 2 === 0) {
    set(bx, by, '#ff5a4a');
    set(bx, by - 1, '#ffb0a0', 0.6);
  }
  // windmill sails
  for (const [sx, sy, color] of scene.sails) {
    const a0 = t * 1.4;
    for (let b = 0; b < 4; b++) {
      const a = a0 + (b * Math.PI) / 2;
      const ux = Math.cos(a),
        uy = Math.sin(a);
      for (let s = 1; s <= 9; s++) {
        set(sx + ux * s, sy + uy * s, '#8a7a68');
        if (s > 3) set(sx + ux * s - uy * 1.3, sy + uy * s + ux * 1.3, s % 2 ? '#fffaf0' : '#ece4d4');
      }
    }
    set(sx, sy, color);
  }
  // review mist over due beds
  for (const [mx, my] of scene.mist)
    for (let p = 0; p < 2; p++) {
      const ox = Math.round(Math.sin(t * 0.8 + p * 2 + mx) * 2) + (p ? 3 : -3),
        oy = Math.round(Math.cos(t * 0.6 + p) * 1) - p;
      for (let yy = -1; yy <= 1; yy++)
        for (let xx = -3; xx <= 3; xx++)
          if (Math.abs(xx) + Math.abs(yy) * 2 <= 3) set(mx + ox + xx, my + oy + yy, '#f4f8fb', 0.62);
    }
  // boat
  if (scene.boat) {
    const b = scene.boat,
      bob = Math.sin(t * 1.8) > 0 ? 0 : 1;
    for (let y = 0; y < b.h; y++)
      for (let x = 0; x < b.w; x++) {
        const v = b.data[y * b.w + x];
        if (v >>> 24 < 128) continue;
        const X = b.x + x,
          Y = b.y + y + bob;
        if (X >= 0 && Y >= 0 && X < lw && Y < lh) frame[Y * lw + X] = v;
      }
    for (let x = 1; x < b.w - 1; x++) set(b.x + x, b.y + b.h + bob, C.shallow2, 0.8);
  }
  // gulls
  for (let g = 0; g < 2; g++) {
    const x = ((t * (6 + g * 2) + g * 157) % (lw + 40)) - 20;
    const y = lh * (0.12 + g * 0.55) + Math.sin(t * 1.2 + g) * 3;
    const up = Math.floor(t * 4 + g) % 2 === 0;
    const pts = up
      ? [[-2, -1], [-1, 0], [0, 0], [1, 0], [2, -1]]
      : [[-2, 1], [-1, 0], [0, 0], [1, 0], [2, 1]];
    for (const [px, py] of pts) set(x + px, y + py, '#ffffff');
    set(x, y + 1, '#c9d6d8');
    for (let k = -1; k <= 1; k++) set(x + 6 + k, y + 16, '#24414a', 0.16);
  }
  // hover outline
  if (hover !== null) {
    const pulse = 0.55 + 0.3 * Math.sin(t * 5);
    for (const i of scene.hover.get(hover) || []) frame[i] = blendPacked(frame[i], '#fffbe6', pulse);
  }
  ctx.putImageData(image, 0, 0);
}
