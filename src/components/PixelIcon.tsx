import { useEffect, useRef, type ReactElement } from 'react';
import { C, Painter, ROOF, makeSprite, pineSprite } from '../pixel/sprites';

const COLORS: Record<string, string> = {
  k: '#33413b',
  w: '#fffdf4',
  e: '#e3d3b0',
  r: '#e07a63',
  R: '#bf5d4c',
  g: '#5fa77f',
  G: '#3f7d5f',
  p: '#f3e0ad',
  u: '#5b7fa6',
  h: '#6d4b2f',
  s: '#f6d2ad',
  m: '#e48a74',
  b: '#6ea9cf',
  B: '#4f86ad',
};

const ICONS = {
  review: [
    '................',
    '....k......k....',
    '.kkkwkkkkkkwkkk.',
    '.krrwrrrrrrwrrk.',
    '.kRRRRRRRRRRRRk.',
    '.kkkkkkkkkkkkkk.',
    '.kwwwwwwwwwwwwk.',
    '.kweeweeweewggk.',
    '.kweeweeweewggk.',
    '.kwwwwwwwwwwwwk.',
    '.kweeweeweewwwk.',
    '.kweeweeweewwwk.',
    '.kwwwwwwwwwwwwk.',
    '.kkkkkkkkkkkkkk.',
    '................',
    '................',
  ],
  read: [
    '................',
    '..kkkkkkkkkkk...',
    '.kGgggggggggk...',
    '.kGgpppppppgk...',
    '.kGgpkkkkkpgk...',
    '.kGgpppppppgk...',
    '.kGgpkkkpppgk...',
    '.kGgpppppppgk...',
    '.kGgggggggggk...',
    '.kGgggggggggk...',
    '.kGgggggggggk...',
    '.kGkkkkkkkkkk...',
    '.kGwwwwwwwwwwk..',
    '.kkeeeeeeeeeek..',
    '..kkkkkkkkrkkk..',
    '..........r.....',
  ],
  party: [
    '......kkkk......',
    '.....ku..uk.....',
    '.....kuuuuk.....',
    '......kkkk......',
    '...kuuuuuuuuk...',
    '...kkkkuukkkk...',
    '......kuuk......',
    '......kuuk......',
    '......kuuk......',
    '......kuuk......',
    '.k....kuuk....k.',
    'kuk...kuuk...kuk',
    'kuuk..kuuk..kuuk',
    '.kuukkkuukkkuuk.',
    '..kkuuuuuuuukk..',
    '....kkkkkkkk....',
  ],
  profile: [
    '................',
    '.....kkkkkk.....',
    '....khhhhhhk....',
    '...khhhhhhhhk...',
    '...khssssshhk...',
    '...kssksskssk...',
    '...kssssssssk...',
    '....kssmmssk....',
    '.....kkkkkk.....',
    '....kBBbbBBk....',
    '...kBbbbbbbBk...',
    '..kBbbbbbbbbBk..',
    '..kBbbbbbbbbBk..',
    '..kBbbbbbbbbBk..',
    '..kkkkkkkkkkkk..',
    '................',
  ],
} as const;
export type PixelIconName = keyof typeof ICONS;

export function PixelIcon({ name, size = 24 }: { name: PixelIconName; size?: number }) {
  const rows = ICONS[name];
  const rects: ReactElement[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === ch) end++;
      if (ch !== '.') rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={end - x} height={1} fill={COLORS[ch]} />);
      x = end;
    }
  });
  return (
    <svg
      className="pixel-icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {rects}
    </svg>
  );
}

let emblemUrl = '';
function emblem() {
  if (emblemUrl) return emblemUrl;
  // tall enough for the pine (20px with outline) so its tip is never cut off
  const W = 30,
    H = 30;
  const island = makeSprite(W, 10, (p: Painter) => {
    p.ellipse(14.5, 5, 14, 4.4, (x, y) => (y > 6 ? C.sandD : C.sand));
    p.ellipse(14.5, 3.6, 11.5, 3, (x, y) => (y < 2 ? C.grassL : x > 20 ? C.grassD : C.grass));
    for (let x = 4; x < 26; x++) if ((x * 7) % 5 === 0) p.px(x, 6, C.cliffD);
  });
  const house = makeSprite(9, 9, (p: Painter) => {
    const roof = ROOF.apricot;
    for (let r = 0; r < 4; r++) p.rect(3 - r + 1, r, (r + 1) * 2 - 1 + 1, 1, r === 0 ? '#eda98f' : r === 3 ? '#b8664e' : roof);
    p.rect(1, 4, 7, 5, C.wall);
    p.rect(6, 4, 1, 5, C.wallD);
    p.rect(4, 6, 1, 3, C.door);
    p.px(2, 5, C.window);
  });
  const tree = pineSprite(0);
  const canvas = document.createElement('canvas');
  canvas.width = W + 2;
  canvas.height = H + 2;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(island.canvas, 0, H - 11);
  ctx.drawImage(tree.canvas, 5, H - 8 - tree.h + 1);
  ctx.drawImage(house.canvas, 15, H - 8 - house.h + 1);
  emblemUrl = canvas.toDataURL();
  return emblemUrl;
}

export function PixelEmblem({ size = 52 }: { size?: number }) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.src = emblem();
  }, []);
  return <img ref={ref} className="pixel-emblem" width={size} height={size} alt="" aria-hidden="true" />;
}
