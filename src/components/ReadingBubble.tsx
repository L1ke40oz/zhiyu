import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { ChatIcon } from 'naive-icons/icons/ChatIcon';

function useDrag(bottom: number) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const element = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const clamp = () => {
      const rect = element.current?.getBoundingClientRect();
      if (rect)
        setPosition((old) =>
          old
            ? {
                x: Math.max(10, Math.min(old.x, window.innerWidth - rect.width - 10)),
                y: Math.max(10, Math.min(old.y, window.innerHeight - rect.height - 96)),
              }
            : null,
        );
    };
    window.addEventListener('resize', clamp);
    return () => window.removeEventListener('resize', clamp);
  }, []);
  function down(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest('[data-no-drag]')) return;
    const movable = event.currentTarget.closest<HTMLElement>('[data-movable]')!;
    element.current = movable;
    const rect = movable.getBoundingClientRect();
    drag.current = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<HTMLElement>) {
    const state = drag.current,
      rect = element.current?.getBoundingClientRect();
    if (!state || !rect) return;
    const dx = event.clientX - state.x,
      dy = event.clientY - state.y;
    if (Math.hypot(dx, dy) > 5) state.moved = true;
    if (state.moved)
      setPosition({
        x: Math.max(10, Math.min(state.left + dx, window.innerWidth - rect.width - 10)),
        y: Math.max(10, Math.min(state.top + dy, window.innerHeight - rect.height - 96)),
      });
  }
  function up(event: PointerEvent<HTMLElement>) {
    const moved = drag.current?.moved;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    return moved;
  }
  return {
    style: position
      ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' }
      : { right: 20, bottom },
    down,
    move,
    up,
  };
}
export default function ReadingBubble({
  open,
  onToggle,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const bubble = useDrag(112),
    panel = useDrag(180),
    dragged = useRef(false);
  return (
    <>
      <button
        className={`reading-bubble ${open ? 'opened' : ''}`}
        data-movable
        aria-label={open ? '收起共读伙伴' : '打开共读伙伴'}
        aria-expanded={open}
        title="拖动气泡，点击提问"
        style={bubble.style}
        onPointerDown={(event) => {
          dragged.current = false;
          bubble.down(event);
        }}
        onPointerMove={bubble.move}
        onPointerUp={(event) => {
          dragged.current = Boolean(bubble.up(event));
        }}
        onPointerCancel={bubble.up}
        onClick={() => {
          if (!dragged.current) onToggle();
        }}
      >
        <ChatIcon size={26} />
        <span>问 AI</span>
      </button>
      <aside
        className="reading-chat-window"
        aria-label="共读伙伴"
        data-movable
        hidden={!open}
        style={panel.style}
      >
        <header
          className="reading-chat-handle"
          onPointerDown={panel.down}
          onPointerMove={panel.move}
          onPointerUp={panel.up}
          onPointerCancel={panel.up}
        >
          <span>
            ✦ 共读伙伴 <small>拖动这里移动</small>
          </span>
          <button data-no-drag aria-label="关闭共读伙伴" onClick={onToggle}>
            ×
          </button>
        </header>
        {children}
      </aside>
    </>
  );
}
