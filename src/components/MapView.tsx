import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from "react";
import type { MapEdge, MapItem, MapLayout } from "../mapLayout";
import { Icon } from "./Icon";

export interface MapHandle {
  fit: () => void;
  focus: (ids: string[]) => void;
}

const MIN = 0.15;
const MAX = 2.5;

function edgePath(e: MapEdge): string {
  const p = e.points;
  if (p.length < 2) return "";
  if (e.style === "similar") {
    const [a, b] = [p[0], p[p.length - 1]];
    const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.15;
    const my = (a.y + b.y) / 2 - (b.x - a.x) * 0.15;
    return `M${a.x},${a.y} Q${mx},${my} ${b.x},${b.y}`;
  }
  let d = `M${p[0].x},${p[0].y}`;
  for (let i = 1; i < p.length - 1; i++) {
    const m = { x: (p[i].x + p[i + 1].x) / 2, y: (p[i].y + p[i + 1].y) / 2 };
    d += ` Q${p[i].x},${p[i].y} ${m.x},${m.y}`;
  }
  const last = p[p.length - 1];
  return `${d} L${last.x},${last.y}`;
}

const KIND_LABEL = { foundation: "Foundation", step: "Step", conclusion: "Conclusion" } as const;

/** The pannable, zoomable canvas: pinch and drag, plus buttons. */
export function MapView({
  layout,
  selected,
  highlight,
  bookmarked,
  onTapItem,
  onTapGroup,
  onTapBackground,
  handleRef,
}: {
  layout: MapLayout;
  selected: Set<string>;
  /** lineage of the selection; everything else is dimmed */
  highlight?: Set<string>;
  bookmarked: Set<string>;
  onTapItem: (item: MapItem) => void;
  onTapGroup: (groupId: string) => void;
  onTapBackground: () => void;
  handleRef?: Ref<MapHandle>;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [t, setT] = useState({ x: 0, y: 0, k: 1 });
  const tRef = useRef(t);
  tRef.current = t;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; k: number; mid: { x: number; y: number }; tx: number; ty: number } | null>(null);
  const moved = useRef(0);

  const size = () => {
    const r = box.current?.getBoundingClientRect();
    return { w: r?.width ?? 360, h: r?.height ?? 500, left: r?.left ?? 0, top: r?.top ?? 0 };
  };

  const frame = useCallback(
    (bx: { l: number; t: number; r: number; b: number }, opts: { maxK?: number; minK?: number; top?: boolean } = {}) => {
      const { w, h } = size();
      const pad = 16;
      const bw = Math.max(bx.r - bx.l, 1);
      const bh = Math.max(bx.b - bx.t, 1);
      let k = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh, opts.maxK ?? 1.1);
      k = Math.max(k, opts.minK ?? MIN);
      const x = (w - bw * k) / 2 - bx.l * k;
      const y = opts.top ? pad - bx.t * k : (h - bh * k) / 2 - bx.t * k;
      setT({ x, y, k });
    },
    [],
  );

  const fit = useCallback(() => frame({ l: 0, t: 0, r: layout.width, b: layout.height }), [frame, layout.width, layout.height]);
  const focus = useCallback(
    (ids: string[]) => {
      const items = layout.items.filter((i) => ids.includes(i.id));
      if (!items.length) return fit();
      const bx = {
        l: Math.min(...items.map((i) => i.x - i.w / 2)),
        r: Math.max(...items.map((i) => i.x + i.w / 2)),
        t: Math.min(...items.map((i) => i.y - i.h / 2)),
        b: Math.max(...items.map((i) => i.y + i.h / 2)),
      };
      frame(bx, { minK: 0.45, maxK: 1, top: true });
    },
    [frame, fit, layout.items],
  );
  useImperativeHandle(handleRef, () => ({ fit, focus }), [fit, focus]);
  useLayoutEffect(() => {
    if (t.k === 1 && t.x === 0 && t.y === 0) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const zoomAt = (factor: number, cx?: number, cy?: number) => {
    const { w, h } = size();
    const px = cx ?? w / 2;
    const py = cy ?? h / 2;
    setT((p) => {
      const k = Math.min(MAX, Math.max(MIN, p.k * factor));
      return { k, x: px - ((px - p.x) * k) / p.k, y: py - ((py - p.y) * k) / p.k };
    });
  };

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const { left, top } = size();
      zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - left, e.clientY - top);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);

  const onDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) moved.current = 0;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const { left, top } = size();
      gesture.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        k: tRef.current.k,
        mid: { x: (a.x + b.x) / 2 - left, y: (a.y + b.y) / 2 - top },
        tx: tRef.current.x,
        ty: tRef.current.y,
      };
    }
  };
  const onMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, cur);
    if (pointers.current.size === 1) {
      const dx = cur.x - prev.x;
      const dy = cur.y - prev.y;
      moved.current += Math.abs(dx) + Math.abs(dy);
      if (moved.current > 6) setT((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));
    } else if (pointers.current.size === 2 && gesture.current) {
      moved.current = 99;
      const [a, b] = [...pointers.current.values()];
      const g = gesture.current;
      const k = Math.min(MAX, Math.max(MIN, (g.k * Math.hypot(a.x - b.x, a.y - b.y)) / g.dist));
      const { left, top } = size();
      const mid = { x: (a.x + b.x) / 2 - left, y: (a.y + b.y) / 2 - top };
      setT({ k, x: mid.x - ((g.mid.x - g.tx) * k) / g.k, y: mid.y - ((g.mid.y - g.ty) * k) / g.k });
    }
  };
  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current = null;
  };
  const dimmed = (id: string) => !!highlight && highlight.size > 0 && !highlight.has(id);

  return (
    <div
      className="map"
      ref={box}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onClickCapture={(e) => {
        if (moved.current > 6) {
          e.stopPropagation();
          e.preventDefault();
        }
      }}
      onClick={(e) => {
        if (e.target === box.current) onTapBackground();
      }}
      data-testid="map"
    >
      <div className="map-canvas" style={{ width: layout.width, height: layout.height, transform: `translate(${t.x}px, ${t.y}px) scale(${t.k})` }} onClick={(e) => e.target === e.currentTarget && onTapBackground()}>
        <svg className="map-edges" width={layout.width} height={layout.height} aria-hidden>
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
            </marker>
          </defs>
          {layout.groups.map((g) => (
            <rect key={g.id} x={g.x} y={g.y} width={g.w} height={g.h} rx={12} className={`map-group ${dimmed(g.id) ? "dim" : ""}`} />
          ))}
          {layout.edges.map((e, i) => (
            <path
              key={i}
              d={edgePath(e)}
              className={`edge ${e.style} ${highlight?.size && highlight.has(e.from) && highlight.has(e.to) ? "hot" : dimmed(e.from) || dimmed(e.to) ? "dim" : ""}`}
              markerEnd={e.style === "similar" ? undefined : "url(#arrow)"}
              data-edge={`${e.from}>${e.to}`}
              data-style={e.style}
            />
          ))}
        </svg>
        {layout.groups.map((g) => (
          <button key={g.id} className={`group-title ${selected.has(g.id) ? "on" : ""} ${dimmed(g.id) ? "dim" : ""}`} style={{ left: g.x + 8, top: g.y + 4, maxWidth: g.w - 16 }} onClick={() => onTapGroup(g.id)} data-group={g.id}>
            {g.title}
          </button>
        ))}
        {layout.items.map((i) => (
          <button
            key={i.id}
            className={`item ${i.type === "question" ? "qb" : "node"} ${i.kind ?? ""} ${selected.has(i.id) ? "on" : ""} ${dimmed(i.id) ? "dim" : ""} ${i.status === "streaming" ? "busy" : ""} ${i.status === "error" || i.status === "length" ? "bad" : ""}`}
            style={{ left: i.x - i.w / 2, top: i.y - i.h / 2, width: i.w, minHeight: i.h }}
            onClick={() => onTapItem(i)}
            data-item={i.id}
            aria-pressed={selected.has(i.id)}
          >
            {i.type === "node" && (
              <span className="item-kind">
                {i.kind ? KIND_LABEL[i.kind] : ""}
                {bookmarked.has(i.id) && <Icon name="bookmark" filled size={11} />}
              </span>
            )}
            {i.type === "node" && i.kind === "conclusion" && i.title && <strong className="item-title">{i.title}</strong>}
            <span className="item-text">{i.type === "question" ? `Q: ${i.text}` : i.text}</span>
          </button>
        ))}
      </div>
      <div className="map-controls" onPointerDown={(e) => e.stopPropagation()}>
        <button className="btn icon sm" aria-label="Zoom in" onClick={() => zoomAt(1.25)}><Icon name="plus" /></button>
        <button className="btn icon sm" aria-label="Zoom out" onClick={() => zoomAt(0.8)}><Icon name="minus" /></button>
        <button className="btn icon sm" aria-label="Fit the whole map" onClick={fit}><Icon name="fit" /></button>
      </div>
    </div>
  );
}
