import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "../Icon";

/** Pinch to zoom and drag to move, plus − + Fit buttons, for a fixed-size drawing (the mind map, concept maps). */
export function PanZoom({ width, height, children, label }: { width: number; height: number; children: ReactNode; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [t, setT] = useState({ x: 0, y: 0, k: 1 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const start = useRef<{ t: typeof t; d: number; cx: number; cy: number } | null>(null);

  const fit = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const k = Math.min(el.clientWidth / width, el.clientHeight / height, 1.4) * 0.95;
    setT({ k, x: (el.clientWidth - width * k) / 2, y: (el.clientHeight - height * k) / 2 });
  }, [width, height]);
  useEffect(fit, [fit]);

  const zoom = (f: number) => {
    const el = box.current;
    if (!el) return;
    const cx = el.clientWidth / 2;
    const cy = el.clientHeight / 2;
    setT((p) => {
      const k = Math.min(4, Math.max(0.15, p.k * f));
      return { k, x: cx - ((cx - p.x) * k) / p.k, y: cy - ((cy - p.y) * k) / p.k };
    });
  };

  const onDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const ps = [...pointers.current.values()];
    start.current = ps.length === 2
      ? { t, d: Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y), cx: (ps[0].x + ps[1].x) / 2, cy: (ps[0].y + ps[1].y) / 2 }
      : { t, d: 0, cx: e.clientX, cy: e.clientY };
  };
  const onMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !start.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const ps = [...pointers.current.values()];
    const s = start.current;
    if (ps.length === 2 && s.d) {
      const d = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
      const k = Math.min(4, Math.max(0.15, (s.t.k * d) / s.d));
      const rect = box.current!.getBoundingClientRect();
      const cx = s.cx - rect.left;
      const cy = s.cy - rect.top;
      setT({ k, x: cx - ((cx - s.t.x) * k) / s.t.k, y: cy - ((cy - s.t.y) * k) / s.t.k });
    } else if (ps.length === 1) {
      setT({ ...s.t, x: s.t.x + e.clientX - s.cx, y: s.t.y + e.clientY - s.cy });
    }
  };
  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const ps = [...pointers.current.values()];
    start.current = ps.length === 1 ? { t, d: 0, cx: ps[0].x, cy: ps[0].y } : null;
  };

  return (
    <div className="panzoom" ref={box} role="img" aria-label={label} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      <div className="panzoom-canvas" style={{ width, height, transform: `translate(${t.x}px, ${t.y}px) scale(${t.k})` }}>
        {children}
      </div>
      <div className="map-controls">
        <button className="btn icon sm" aria-label="Zoom in" onClick={() => zoom(1.3)}><Icon name="plus" /></button>
        <button className="btn icon sm" aria-label="Zoom out" onClick={() => zoom(1 / 1.3)}><Icon name="minus" /></button>
        <button className="btn icon sm" aria-label="Fit" onClick={fit}><Icon name="fit" /></button>
      </div>
    </div>
  );
}
