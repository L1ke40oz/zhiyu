export const COURSES_PER_SEA = 6;
export const MAX_COURSES = 30;

export interface IslandPosition {
  x: number;
  y: number;
  size: number;
}
export interface OceanLayout {
  courses: IslandPosition[];
  registry: IslandPosition;
  usableHeight: number;
}

// All six spaces are reserved from the first course onward. The number of
// occupied spaces never participates in the scale or position calculation.
export function oceanLayout(width: number, height: number): OceanLayout {
  const usableHeight = Math.max(1, height - (width >= 700 ? 110 : 0));
  const size = Math.min(260, width * 0.28, Math.max(1, usableHeight - 64) * 0.24);
  const centerX = width * 0.5,
    centerY = usableHeight * (width >= 700 ? 0.5 : 0.55);
  const offsets = [
    [-1.1, -0.5],
    [0, -0.9],
    [1.1, -0.3],
    [-1.1, 0.75],
    [0, 1.05],
    [1.1, 0.9],
  ];
  const registrySize = Math.min(180, width * 0.23, usableHeight * 0.24);
  return {
    courses: offsets.map(([x, y]) => ({ x: centerX + x * size, y: centerY + y * size, size })),
    registry: {
      x: Math.max(registrySize * 0.68, Math.min(width * 0.13, registrySize * 0.95)),
      y: registrySize * 0.78 + 14,
      size: registrySize,
    },
    usableHeight,
  };
}
