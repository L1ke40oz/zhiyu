import { useEffect, useMemo, useRef, useState } from 'react';
import type { Course } from '../../shared/types';
import { createWorld, ISLET, type Orientation } from '../pixel/world';
import { buildScene, drawFrame, REGISTRY, type Scene } from '../pixel/render';
import { BUILDING_LABEL, buildingKindFor } from '../pixel/sprites';
import { hashString } from '../pixel/render';

type Props = {
  courses: Course[];
  sea: number;
  reducedMotion: boolean;
  active: boolean;
  onSelect: (courseId: string) => void;
  onCreate: (slot: number | null) => void;
};
interface View {
  scene: Scene;
  scale: number;
  dpr: number;
  cssW: number;
  cssH: number;
}

export default function PixelIsland({ courses, sea, reducedMotion, active, onSelect, onCreate }: Props) {
  const hostRef = useRef<HTMLDivElement>(null),
    canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const hoverRef = useRef<number | null>(null);
  hoverRef.current = hover;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const resize = () => {
      if (host.clientWidth && host.clientHeight) setSize({ w: host.clientWidth, h: host.clientHeight });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    return () => observer.disconnect();
  }, []);

  const courseKey = JSON.stringify(
    courses.map((c) => [c.id, c.name, c.palette, c.slotId, c.pointCount, c.masteredCount, c.developingCount, c.documentCount, c.regions]),
  );
  const view = useMemo<View | null>(() => {
    if (!size) return null;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const desktop = size.w >= 700;
    const reserveBottom = desktop ? 84 : 70,
      reserveTop = desktop ? 30 : 46;
    const usableH = Math.max(120, size.h - reserveBottom - reserveTop);
    const orientation: Orientation = size.w / usableH > 0.95 ? 'landscape' : 'portrait';
    const world = createWorld(orientation, sea);
    const ideal = Math.min((size.w * dpr) / (world.w + 10), (usableH * dpr) / (world.h + 6));
    const floor = Math.floor(ideal);
    const scale = floor >= 1 && floor >= ideal * 0.82 ? floor : Math.max(1, ideal);
    const physW = Math.round(size.w * dpr),
      physH = Math.round(size.h * dpr);
    const lw = Math.ceil(physW / scale),
      lh = Math.ceil(physH / scale);
    const top = (reserveTop * dpr) / scale,
      usableL = (usableH * dpr) / scale;
    const ox = Math.floor((lw - world.w) / 2),
      oy = Math.max(2, Math.floor(top + (usableL - world.h) / 2));
    // UI panels floating over the sea (CSS px) so decorations stay visible
    const css = (x0: number, y0: number, x1: number, y1: number) => ({
      x0: (x0 * dpr) / scale,
      y0: (y0 * dpr) / scale,
      x1: (x1 * dpr) / scale,
      y1: (y1 * dpr) / scale,
    });
    const keepOut = desktop
      ? [
          css(size.w - 270, 0, size.w, 90),
          css(size.w / 2 - 320, size.h - 80, size.w / 2 + 320, size.h),
          ...(size.w >= 1100 ? [css(0, size.h - 120, 300, size.h)] : []),
        ]
      : [css(size.w / 2 - 125, size.h - 80, size.w / 2 + 125, size.h)];
    const scene = buildScene(world, courses, lw, lh, ox, oy, keepOut);
    return { scene, scale, dpr, cssW: size.w, cssH: size.h };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, sea, courseKey]);

  // render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !view) return;
    const { scene, scale, dpr } = view;
    canvas.width = Math.round(view.cssW * dpr);
    canvas.height = Math.round(view.cssH * dpr);
    const ctx = canvas.getContext('2d')!;
    const small = document.createElement('canvas');
    small.width = scene.lw;
    small.height = scene.lh;
    const sctx = small.getContext('2d')!;
    const image = sctx.createImageData(scene.lw, scene.lh);
    const frame = new Uint32Array(image.data.buffer);
    let raf = 0,
      last = -1;
    const start = performance.now();
    const paint = (t: number) => {
      drawFrame(sctx, scene, frame, image, t, hoverRef.current);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(small, 0, 0, scene.lw * scale, scene.lh * scale);
    };
    const still = reducedMotion || !active;
    if (still) {
      paint(4);
      const id = window.setInterval(() => paint(4), 250);
      return () => window.clearInterval(id);
    }
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const t = (now - start) / 1000;
      if (t - last < 0.1) return;
      last = t;
      paint(t);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [view, reducedMotion, active]);

  function slotAt(clientX: number, clientY: number) {
    const canvas = canvasRef.current;
    if (!canvas || !view) return null;
    const rect = canvas.getBoundingClientRect();
    const { scene, scale, dpr } = view;
    const lx = Math.floor(((clientX - rect.left) * dpr) / scale) - scene.ox,
      ly = Math.floor(((clientY - rect.top) * dpr) / scale) - scene.oy;
    const w = scene.world;
    if (lx < 0 || ly < 0 || lx >= w.w || ly >= w.h) return null;
    const cell = w.cell[ly * w.w + lx];
    if (cell === ISLET) return REGISTRY;
    return cell >= 0 && cell < 6 ? cell : null;
  }
  function activate(slot: number) {
    if (slot === REGISTRY) return onCreate(null);
    const course = courses.find((c) => c.slotId === slot);
    if (course) onSelect(course.id);
    else onCreate(slot);
  }
  const k = view ? view.scale / view.dpr : 1;

  return (
    <div className="px-island" ref={hostRef}>
      <canvas
        ref={canvasRef}
        className={`px-canvas ${hover !== null ? 'pointing' : ''}`}
        onPointerMove={(e) => {
          const slot = slotAt(e.clientX, e.clientY);
          if (slot !== hover) setHover(slot);
        }}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => {
          const slot = slotAt(e.clientX, e.clientY);
          if (slot !== null) activate(slot);
        }}
        aria-hidden="true"
      />
      {view?.scene.anchors.map((anchor) => {
        const style = { left: anchor.x * k, top: anchor.y * k };
        const events = {
          onPointerEnter: () => setHover(anchor.slot),
          onPointerLeave: () => setHover(null),
          onFocus: () => setHover(anchor.slot),
          onBlur: () => setHover(null),
        };
        if (anchor.kind === 'registry')
          return (
            <button key="registry" className="px-label px-registry" style={style} onClick={() => onCreate(null)} {...events}>
              <b>岛屿登记处</b>
              <small>开辟新课程 ＋</small>
            </button>
          );
        if (anchor.kind === 'empty')
          return (
            <button
              key={`empty-${anchor.slot}`}
              className={`px-label px-empty ${hover === anchor.slot ? 'is-hover' : ''}`}
              style={style}
              onClick={() => onCreate(anchor.slot)}
              aria-label={`第 ${anchor.slot + 1} 号空地，登记新课程`}
              {...events}
            >
              <span>＋</span>空地
            </button>
          );
        const course = anchor.course!;
        const kind = buildingKindFor(course.name, hashString(course.id));
        const status = course.dueCount
          ? `${course.dueCount} 处待回访`
          : course.stuckCount
            ? `${course.stuckCount} 个小卡点`
            : course.pointCount
              ? `已长成 ${course.masteredCount}/${course.pointCount}`
              : course.documentCount
                ? '整理知识中'
                : '待放入课件';
        return (
          <button
            key={course.id}
            className={`px-label px-course palette-${course.palette} ${hover === anchor.slot ? 'is-hover' : ''} ${course.dueCount ? 'is-due' : ''}`}
            style={style}
            onClick={() => onSelect(course.id)}
            aria-label={`进入${course.name}（${BUILDING_LABEL[kind]}）`}
            {...events}
          >
            <b>{course.name}</b>
            <small>{status}</small>
          </button>
        );
      })}
    </div>
  );
}
