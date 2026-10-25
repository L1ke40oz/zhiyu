import { useMemo, useState } from 'react';
import type { KnowledgePoint, Palette, StuckPoint } from '../../shared/types';
import { ROOF } from '../pixel/sprites';
import { dayLabel } from './Shared';

type NodeKind = 'course' | 'region' | 'point' | 'stuck';
interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  point?: KnowledgePoint;
  stuck?: StuckPoint;
}
interface GraphEdge {
  a: number;
  b: number;
  kind: 'tree' | 'source';
}

const W = 360;
const STATE_COLOR: Record<KnowledgePoint['state'], string> = {
  unexplored: '#c9bfa6',
  developing: '#f0c75e',
  mastered: '#7fbf73',
};
const STATE_TEXT: Record<KnowledgePoint['state'], string> = {
  unexplored: '待探索',
  developing: '正在巩固',
  mastered: '已掌握',
};
const short = (text: string, n: number) => (text.length > n ? `${text.slice(0, n)}…` : text);
const pointWidth = (title: string) => Math.max(44, short(title, 7).length * 11 + 14);
const stuckLabel = (text: string) => `？${short(text.replace(/\s+/g, ' '), 6)}`;
/** half extents of a node's box, including a little breathing room */
function halfSize(node: GraphNode) {
  if (node.kind === 'course') return [38, 17];
  if (node.kind === 'region') return [31, 14];
  if (node.kind === 'stuck') return [pointWidth(node.label) / 2 + 6, 15];
  return [pointWidth(node.label) / 2 + 10, 15];
}

/** Deterministic force layout: course in the middle, regions around it, points around regions. */
function layout(courseName: string, points: KnowledgePoint[], loose: StuckPoint[]) {
  const H = Math.min(560, Math.max(280, 150 + (points.length + loose.length) * 18));
  const nodes: GraphNode[] = [
    { id: 'course', kind: 'course', label: courseName, x: W / 2, y: H / 2, vx: 0, vy: 0 },
  ];
  const edges: GraphEdge[] = [];
  const groups = [...new Set(points.map((point) => point.groupIndex))].sort((a, b) => a - b);
  const regionIndex = new Map<number, number>();
  groups.forEach((group, k) => {
    const angle = (k / groups.length) * Math.PI * 2 - Math.PI / 2;
    regionIndex.set(group, nodes.length);
    nodes.push({
      id: `region-${group}`,
      kind: 'region',
      label: `知识区 ${group + 1}`,
      x: W / 2 + Math.cos(angle) * 70,
      y: H / 2 + Math.sin(angle) * 60,
      vx: 0,
      vy: 0,
    });
    edges.push({ a: 0, b: nodes.length - 1, kind: 'tree' });
  });
  points.forEach((point, k) => {
    const parent = regionIndex.get(point.groupIndex)!;
    const angle = k * 2.399;
    nodes.push({
      id: point.id,
      kind: 'point',
      label: point.title,
      point,
      x: nodes[parent].x + Math.cos(angle) * 45,
      y: nodes[parent].y + Math.sin(angle) * 40,
      vx: 0,
      vy: 0,
    });
    edges.push({ a: parent, b: nodes.length - 1, kind: 'tree' });
  });
  // stuck notes that are not tied to any point hang off the course itself
  loose.forEach((note, k) => {
    const angle = Math.PI / 2 + (k - (loose.length - 1) / 2) * 0.5;
    nodes.push({
      id: `stuck-${note.id}`,
      kind: 'stuck',
      label: stuckLabel(note.text),
      stuck: note,
      x: W / 2 + Math.cos(angle) * 80,
      y: H / 2 + Math.sin(angle) * 80,
      vx: 0,
      vy: 0,
    });
    edges.push({ a: 0, b: nodes.length - 1, kind: 'tree' });
  });
  // points that come from the same passage are related
  const pointNodes = nodes.map((node, i) => [node, i] as const).filter(([node]) => node.point);
  for (let i = 0; i < pointNodes.length; i++)
    for (let j = i + 1; j < pointNodes.length; j++) {
      const a = pointNodes[i][0].point!,
        b = pointNodes[j][0].point!;
      if (a.groupIndex !== b.groupIndex && a.sourceChunkIds.some((id) => b.sourceChunkIds.includes(id)))
        edges.push({ a: pointNodes[i][1], b: pointNodes[j][1], kind: 'source' });
    }
  const rest = { tree: 62, source: 90 };
  for (let step = 0; step < 260; step++) {
    const cool = 1 - step / 260;
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i],
          b = nodes[j];
        let dx = b.x - a.x,
          dy = b.y - a.y;
        const d2 = Math.max(dx * dx + dy * dy, 25);
        const force = 1400 / d2;
        const d = Math.sqrt(d2);
        dx /= d;
        dy /= d;
        a.vx -= dx * force;
        a.vy -= dy * force;
        b.vx += dx * force;
        b.vy += dy * force;
      }
    for (const edge of edges) {
      const a = nodes[edge.a],
        b = nodes[edge.b];
      const dx = b.x - a.x,
        dy = b.y - a.y,
        d = Math.max(1, Math.hypot(dx, dy));
      const pull = (d - rest[edge.kind]) * (edge.kind === 'tree' ? 0.06 : 0.02);
      a.vx += (dx / d) * pull;
      a.vy += (dy / d) * pull;
      b.vx -= (dx / d) * pull;
      b.vy -= (dy / d) * pull;
    }
    for (const node of nodes) {
      if (node.kind === 'course') {
        node.x = W / 2;
        node.y = H / 2;
        node.vx = node.vy = 0;
        continue;
      }
      node.x = Math.min(W - 40, Math.max(40, node.x + Math.max(-6, Math.min(6, node.vx)) * cool));
      node.y = Math.min(H - 18, Math.max(18, node.y + Math.max(-6, Math.min(6, node.vy)) * cool));
      node.vx *= 0.5;
      node.vy *= 0.5;
    }
  }
  // boxes are wide, so finish by pushing overlapping boxes apart
  for (let pass = 0; pass < 120; pass++) {
    let moved = false;
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i],
          b = nodes[j];
        const [aw, ah] = halfSize(a),
          [bw, bh] = halfSize(b);
        const ox = aw + bw - Math.abs(b.x - a.x),
          oy = ah + bh - Math.abs(b.y - a.y);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        const fixedA = a.kind === 'course',
          fixedB = b.kind === 'course';
        const share = fixedA ? [0, 1] : fixedB ? [1, 0] : [0.5, 0.5];
        if (oy < ox) {
          const dir = b.y >= a.y ? 1 : -1;
          a.y -= dir * oy * share[0];
          b.y += dir * oy * share[1];
        } else {
          const dir = b.x >= a.x ? 1 : -1;
          a.x -= dir * ox * share[0];
          b.x += dir * ox * share[1];
        }
      }
    for (const node of nodes) {
      if (node.kind === 'course') continue;
      const [hw, hh] = halfSize(node);
      node.x = Math.min(W - hw + 4, Math.max(hw - 4, node.x));
      node.y = Math.min(H - hh + 4, Math.max(hh - 4, node.y));
    }
    if (!moved) break;
  }
  return { nodes, edges, h: H };
}

export default function KnowledgeGraph({
  courseName,
  palette,
  points,
  stuck,
  onQuiz,
  onUnmark,
  onResolve,
}: {
  courseName: string;
  palette: Palette;
  points: KnowledgePoint[];
  stuck: StuckPoint[];
  onQuiz: (point: KnowledgePoint) => void;
  onUnmark: (point: KnowledgePoint) => void;
  onResolve: (note: StuckPoint) => void;
}) {
  const open = useMemo(() => stuck.filter((note) => !note.resolved), [stuck]);
  // a point with an open stuck note is always in the graph
  const marked = useMemo(
    () => points.filter((point) => point.unfamiliar || open.some((note) => note.pointId === point.id)),
    [points, open],
  );
  const loose = useMemo(
    () => open.filter((note) => !note.pointId || !points.some((point) => point.id === note.pointId)),
    [open, points],
  );
  const graph = useMemo(() => layout(courseName, marked, loose), [courseName, marked, loose]);
  const [selected, setSelected] = useState<string | null>(null);
  const current = marked.find((point) => point.id === selected) || null;
  const currentNote = loose.find((note) => `stuck-${note.id}` === selected) || null;
  const notesOf = (point: KnowledgePoint) => open.filter((note) => note.pointId === point.id);
  if (!marked.length && !loose.length)
    return (
      <div className="kg-empty">
        <svg viewBox="0 0 48 32" width="120" height="80" shapeRendering="crispEdges" aria-hidden="true">
          <rect x="21" y="12" width="6" height="6" fill="#33413b" />
          <rect x="22" y="13" width="4" height="4" fill={ROOF[palette]} />
          {[
            [6, 4],
            [38, 6],
            [8, 24],
            [36, 24],
          ].map(([x, y]) => (
            <g key={`${x}-${y}`}>
              <rect x={x} y={y} width="5" height="5" fill="#33413b" />
              <rect x={x + 1} y={y + 1} width="3" height="3" fill="#e9dfc6" />
            </g>
          ))}
          <path d="M11 7h10M27 15h11M11 26h11M27 17h9" stroke="#c9bfa6" strokeDasharray="1 1" />
        </svg>
        <b>知识图谱还是空的</b>
        <p>
          把拿不准的知识点标成「不熟」，或者记一个卡点、在共读时点「这里不懂」，它们都会出现在这里，按知识区连成一张图。
        </p>
      </div>
    );
  return (
    <div className="kg">
      <div className="kg-legend">
        {(['unexplored', 'developing', 'mastered'] as const).map((state) => (
          <span key={state}>
            <i style={{ background: STATE_COLOR[state] }} />
            {STATE_TEXT[state]}
          </span>
        ))}
        <span>
          <i className="kg-dash" />
          同一段原文
        </span>
        <span>
          <i className="kg-stuck" />
          卡点
        </span>
      </div>
      <svg
        className="kg-canvas"
        viewBox={`0 0 ${W} ${graph.h}`}
        role="img"
        aria-label={`${courseName}的不熟知识点图谱`}
      >
        {graph.edges.map((edge, k) => {
          const a = graph.nodes[edge.a],
            b = graph.nodes[edge.b];
          return (
            <line
              key={k}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={edge.kind === 'tree' ? '#b9ad8f' : '#d98e76'}
              strokeWidth={edge.kind === 'tree' ? 2 : 1.5}
              strokeDasharray={edge.kind === 'source' ? '3 3' : undefined}
            />
          );
        })}
        {graph.nodes.map((node) => {
          if (node.kind === 'course')
            return (
              <g key={node.id} transform={`translate(${node.x},${node.y})`}>
                <rect x={-34} y={-13} width={68} height={26} fill="#33413b" />
                <rect x={-32} y={-11} width={64} height={22} fill={ROOF[palette]} />
                <text y={4} textAnchor="middle" className="kg-course">
                  {short(node.label, 5)}
                </text>
              </g>
            );
          if (node.kind === 'region')
            return (
              <g key={node.id} transform={`translate(${node.x},${node.y})`}>
                <rect x={-27} y={-10} width={54} height={20} fill="#33413b" />
                <rect x={-25} y={-8} width={50} height={16} fill="#fff6dc" />
                <text y={4} textAnchor="middle" className="kg-region">
                  {node.label}
                </text>
              </g>
            );
          if (node.kind === 'stuck') {
            const width = pointWidth(node.label);
            const active = selected === node.id;
            return (
              <g
                key={node.id}
                className={`kg-point kg-stuck-node ${active ? 'active' : ''}`}
                transform={`translate(${node.x},${node.y})`}
                role="button"
                tabIndex={0}
                aria-label={`卡点：${node.stuck!.text}`}
                onClick={() => setSelected(active ? null : node.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') setSelected(active ? null : node.id);
                }}
              >
                <rect
                  x={-width / 2 - 2}
                  y={-11}
                  width={width + 4}
                  height={22}
                  fill={active ? '#c0533f' : '#d9674f'}
                />
                <rect x={-width / 2} y={-9} width={width} height={18} fill="#fff1ea" />
                <text y={4} textAnchor="middle" className="kg-label">
                  {node.label}
                </text>
              </g>
            );
          }
          const point = node.point!;
          const label = short(point.title, 7);
          const count = notesOf(point).length;
          const width = pointWidth(point.title);
          const active = selected === point.id;
          return (
            <g
              key={node.id}
              className={`kg-point ${active ? 'active' : ''}`}
              transform={`translate(${node.x},${node.y})`}
              role="button"
              tabIndex={0}
              aria-label={`${point.title}，${STATE_TEXT[point.state]}`}
              onClick={() => setSelected(active ? null : point.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') setSelected(active ? null : point.id);
              }}
            >
              <rect
                x={-width / 2 - 2}
                y={-11}
                width={width + 4}
                height={22}
                fill={active ? '#c0533f' : '#33413b'}
              />
              <rect x={-width / 2} y={-9} width={width} height={18} fill="#fffdf4" />
              <rect x={-width / 2} y={-9} width={5} height={18} fill={STATE_COLOR[point.state]} />
              <text x={3} y={4} textAnchor="middle" className="kg-label">
                {label}
              </text>
              {count ? (
                <g transform={`translate(${width / 2 - 2},-11)`}>
                  <rect x={-1} y={-1} width={count > 9 ? 16 : 12} height={12} fill="#33413b" />
                  <rect x={0} y={0} width={count > 9 ? 14 : 10} height={10} fill="#e07a63" />
                  <text x={count > 9 ? 7 : 5} y={8} textAnchor="middle" className="kg-badge">
                    {count > 9 ? '9+' : count}
                  </text>
                </g>
              ) : null}
            </g>
          );
        })}
      </svg>
      {current ? (
        <div className="kg-detail">
          <b>{current.title}</b>
          <small>
            {STATE_TEXT[current.state]}
            {current.nextReviewAt ? ` · ${dayLabel(current.nextReviewAt)}回访` : ''} · 知识区{' '}
            {current.groupIndex + 1}
          </small>
          {notesOf(current).length ? (
            <ul className="kg-notes">
              {notesOf(current).map((note) => (
                <li key={note.id}>
                  <span>
                    {note.text}
                    {note.page ? <em> · 第 {note.page} 页</em> : null}
                  </span>
                  <button className="text-button" onClick={() => onResolve(note)}>
                    想明白了
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div>
            <button className="mini-action" onClick={() => onQuiz(current)}>
              复习一下
            </button>
            <button
              className="text-button"
              onClick={() => {
                setSelected(null);
                onUnmark(current);
              }}
            >
              已经熟了，移出图谱
            </button>
          </div>
        </div>
      ) : currentNote ? (
        <div className="kg-detail">
          <b>还没想明白</b>
          <small>{currentNote.page ? `第 ${currentNote.page} 页 · ` : ''}这个卡点还没关联到知识点</small>
          <p className="kg-note-text">{currentNote.text}</p>
          <div>
            <button
              className="mini-action"
              onClick={() => {
                setSelected(null);
                onResolve(currentNote);
              }}
            >
              想明白了
            </button>
          </div>
        </div>
      ) : (
        <p className="kg-hint">
          点一个节点，可以复习、查看卡点或移出图谱。共 {marked.length} 个不熟的点
          {open.length ? `、${open.length} 个没解决的卡点` : ''}。
        </p>
      )}
    </div>
  );
}
