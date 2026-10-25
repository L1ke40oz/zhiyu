import type { IslandShape } from './types.ts';

export type Point2 = { x: number; z: number };
export type LandscapeElement = Point2 & {
  kind: 'pine' | 'tree' | 'bush' | 'flower' | 'rock' | 'house' | 'growth';
  radius: number;
  scale: number;
  rotation: number;
  region?: number;
};
export function seededRandom(seed: string) {
  let hash = 2166136261;
  for (const char of seed) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return () => {
    hash += 0x6d2b79f5;
    let t = hash;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function outline(shape: IslandShape): Point2[] {
  if (shape === 'polygon')
    return [
      [-1.3, -0.6],
      [-1.1, 0.45],
      [-0.4, 1],
      [0.7, 0.9],
      [1.4, 0.2],
      [1.15, -0.6],
      [0.2, -1],
      [-0.65, -0.9],
    ].map(([x, y]) => ({ x, z: -y }));
  const segments =
    shape === 'bean'
      ? [
          [-1.4, -0.55, -1.55, 0.2, -0.8, 1.05, 0.05, 0.95],
          [0.05, 0.95, 0.7, 1.1, 1.45, 0.6, 1.35, -0.1],
          [1.35, -0.1, 1.25, -0.8, 0.2, -0.58, -0.2, -0.9],
          [-0.2, -0.9, -0.7, -1.2, -1.3, -1, -1.4, -0.55],
        ]
      : [
          [-1.35, -0.4, -1.7, 0.7, -0.3, 1.1, 0.55, 0.85],
          [0.55, 0.85, 1.1, 0.65, 1.45, 0.05, 1.35, -0.55],
          [1.35, -0.55, 0.8, 0.05, 0.5, 0.3, 0.1, 0.05],
          [0.1, 0.05, -0.25, -0.25, -0.45, -1.1, -1, -0.9],
          [-1, -0.9, -1.2, -0.8, -1.35, -0.65, -1.35, -0.4],
        ];
  return segments.flatMap(([x0, y0, x1, y1, x2, y2, x3, y3]) =>
    Array.from({ length: 10 }, (_, i) => {
      const t = i / 10,
        s = 1 - t;
      return {
        x: s ** 3 * x0 + 3 * s * s * t * x1 + 3 * s * t * t * x2 + t ** 3 * x3,
        z: -(s ** 3 * y0 + 3 * s * s * t * y1 + 3 * s * t * t * y2 + t ** 3 * y3),
      };
    }),
  );
}
export function insidePolygon(point: Point2, polygon: Point2[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (a.z > point.z !== b.z > point.z && point.x < ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z) + a.x)
      inside = !inside;
  }
  return inside;
}
export function fitsOnLand(point: Point2, radius: number, polygon: Point2[]) {
  return (
    insidePolygon(point, polygon) &&
    Array.from({ length: 12 }, (_, i) => (i * Math.PI) / 6).every((angle) =>
      insidePolygon(
        { x: point.x + Math.cos(angle) * radius, z: point.z + Math.sin(angle) * radius },
        polygon,
      ),
    )
  );
}
export function createLandscape(seed: string, shape: IslandShape) {
  const random = seededRandom(`zhiyu-landscape-v2:${seed}`);
  const theme = random() < 0.5 ? 'woodland' : 'village';
  const polygon = outline(shape).map((point) => ({ x: point.x * 0.85, z: point.z * 0.85 }));
  const elements: LandscapeElement[] = [];
  function place(kind: LandscapeElement['kind'], radius: number, scale: number, region?: number) {
    for (let attempt = 0; attempt < 700; attempt++) {
      const candidate = { x: (random() - 0.5) * 2.65, z: (random() - 0.5) * 1.95 };
      if (
        !fitsOnLand(candidate, radius + 0.025, polygon) ||
        elements.some(
          (element) =>
            Math.hypot(element.x - candidate.x, element.z - candidate.z) < element.radius + radius + 0.045,
        )
      )
        continue;
      const element = { ...candidate, kind, radius, scale, rotation: (random() - 0.5) * 0.7, region };
      elements.push(element);
      return element;
    }
    return null;
  }
  if (theme === 'village')
    for (let n = 0, count = shape === 'crescent' ? 1 : 1 + Math.floor(random() * 2); n < count; n++)
      place('house', 0.27, 0.42 + random() * 0.04);
  for (let region = 0; region < 3; region++) {
    for (const radius of [0.2, 0.16, 0.12]) if (place('growth', radius, radius * 1.6, region)) break;
  }
  for (let n = 0, count = 5 + Math.floor(random() * 6); n < count; n++) {
    const scale = 0.44 + random() * 0.24;
    place(random() < 0.47 ? 'pine' : 'tree', 0.38 * scale, scale);
  }
  for (let n = 0, count = 3 + Math.floor(random() * 5); n < count; n++) {
    const kind = random() < 0.35 ? 'rock' : random() < 0.5 ? 'flower' : 'bush';
    const scale = 0.5 + random() * 0.5;
    place(kind, (kind === 'bush' ? 0.25 : kind === 'rock' ? 0.16 : 0.13) * scale, scale);
  }
  return { theme, elements, polygon, phase: random() * Math.PI * 2 };
}
