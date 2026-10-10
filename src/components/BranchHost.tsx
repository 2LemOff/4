import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode, type RefObject, type UIEvent } from "react";
import { bubblePreset, clampRect, SEE_THROUGH, type BranchMode, type BubbleSize, type Rect } from "../panes";
import { Icon, type IconName } from "./Icon";

export interface BranchTab {
  id: string;
  /** "①", "1.2" */
  label: string;
  title: string;
  active: boolean;
  onClick?: () => void;
}

const MODE_INFO: Record<BranchMode, { icon: IconName; label: string }> = {
  split: { icon: "split", label: "Split screen" },
  bubble: { icon: "bubble", label: "Bubble" },
  layer: { icon: "layer", label: "Layer" },
};

const read = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage may be unavailable */
  }
};

/** Size of the area the branch floats in (the chat, above the question box); follows the keyboard. */
function useBounds(ref: RefObject<HTMLElement | null>) {
  const [b, setB] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const measure = () => setB({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return b;
}

/** ◐: tap for the next see-through level, hold to see the original clearly ("x-ray"). */
function SeeThrough({ level, onLevel, onXray }: { level: number; onLevel: (n: number) => void; onXray: (on: boolean) => void }) {
  const timer = useRef<number | undefined>(undefined);
  const held = useRef(false);
  const end = () => {
    window.clearTimeout(timer.current);
    if (held.current) onXray(false);
    else onLevel((level + 1) % SEE_THROUGH.length);
    held.current = false;
  };
  return (
    <button
      className="btn icon hbtn"
      aria-label={`See-through (${Math.round(SEE_THROUGH[level] * 100)}%); hold to see the original`}
      onPointerDown={(e) => {
        e.preventDefault();
        held.current = false;
        timer.current = window.setTimeout(() => {
          held.current = true;
          onXray(true);
        }, 350);
      }}
      onPointerUp={end}
      onPointerCancel={() => {
        window.clearTimeout(timer.current);
        if (held.current) onXray(false);
        held.current = false;
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onLevel((level + 1) % SEE_THROUGH.length);
        }
      }}
    >
      <Icon name="seethrough" size={16} />
    </button>
  );
}

/**
 * The branch beside the original, in one of three ways: a split under the paragraph you asked about, a bubble you
 * can move and resize, or a layer over the original that drops to a bar with one tap and can be see-through.
 * The original underneath is never re-laid out or scrolled by this.
 */
export function BranchHost({
  mode,
  onMode,
  tabs,
  crumbs,
  onUp,
  onClose,
  title,
  splitHeight,
  max,
  onMax,
  anchor,
  paneRef,
  onPaneScroll,
  children,
}: {
  mode: BranchMode;
  onMode: (m: BranchMode) => void;
  tabs: BranchTab[];
  /** "Main › ① › 1.1" when the branch is inside another one */
  crumbs?: string;
  onUp?: () => void;
  onClose: () => void;
  /** shown when there's no tab yet (a branch being asked) */
  title: string;
  splitHeight: number;
  max: "none" | "branch" | "original";
  onMax: () => void;
  /** where the asked-about words are (from the top of the chat area), to place a new bubble near them */
  anchor?: { top: number; bottom: number };
  paneRef: RefObject<HTMLDivElement | null>;
  onPaneScroll: (e: UIEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) {
  const self = useRef<HTMLDivElement>(null);
  const bounds = useBounds(self);
  const [see, setSee] = useState<number>(() => read("fractal.seeThrough", 0));
  const [xray, setXray] = useState(false);
  const [down, setDown] = useState(false);
  const [mini, setMini] = useState(false);
  const [home, setHome] = useState<Rect | undefined>(() => read<Rect | undefined>("fractal.bubble", undefined));
  const drag = useRef<{ kind: "move" | "size"; x: number; y: number; r: Rect } | null>(null);
  useEffect(() => write("fractal.seeThrough", see), [see]);
  useEffect(() => {
    if (home) write("fractal.bubble", home);
  }, [home]);

  // a first bubble opens near the words asked about: under them if there's room, else above them
  useEffect(() => {
    if (mode !== "bubble" || home || !bounds.w) return;
    const r = bubblePreset("M", bounds);
    const y = anchor ? (anchor.bottom + 8 + r.h <= bounds.h ? anchor.bottom + 8 : Math.max(0, anchor.top - r.h - 8)) : r.y;
    setHome({ ...r, y });
  }, [mode, home, bounds, anchor]);

  const rect = home && bounds.w ? clampRect(home, bounds) : undefined;
  const bg = `color-mix(in srgb, var(--bg) ${Math.round(SEE_THROUGH[see] * 100)}%, transparent)`;

  const startDrag = (kind: "move" | "size") => (e: PointerEvent<HTMLElement>) => {
    if (!rect) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { kind, x: e.clientX, y: e.clientY, r: rect };
  };
  const onDrag = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    setHome(clampRect(d.kind === "move" ? { ...d.r, x: d.r.x + dx, y: d.r.y + dy } : { ...d.r, w: d.r.w + dx, h: d.r.h + dy }, bounds));
  };
  const endDrag = () => {
    drag.current = null;
  };
  const sizeNext = () => {
    if (!rect) return;
    const order: BubbleSize[] = ["S", "M", "L"];
    const cur = order.findIndex((s) => Math.abs(bubblePreset(s, bounds).w - rect.w) < 4);
    const next = order[(cur + 1) % order.length];
    setHome(clampRect({ ...bubblePreset(next, bounds), x: rect.x, y: rect.y }, bounds));
  };
  const snap = () => rect && setHome(bubblePreset(rect.h > bounds.h * 0.55 ? "M" : rect.w > bounds.w * 0.8 ? "M" : "S", bounds, rect.y > bounds.h / 3 ? "top" : "bottom"));

  const modes = (
    <span className="host-modes" role="group" aria-label="Show the branch as">
      {(Object.keys(MODE_INFO) as BranchMode[]).map((m) => (
        <button key={m} className={`btn icon hbtn ${mode === m ? "on" : ""}`} aria-label={MODE_INFO[m].label} aria-pressed={mode === m} onClick={() => onMode(m)}>
          <Icon name={MODE_INFO[m].icon} size={15} />
        </button>
      ))}
    </span>
  );
  const tabRow = (
    <div className="host-tabs" role="tablist" aria-label="Branches">
      {tabs.length ? (
        tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={t.active} className={`btn chip host-tab ${t.active ? "on" : ""}`} onClick={() => t.onClick?.()}>
            <strong>{t.label}</strong> <span className="ellipsis">{t.title}</span>
          </button>
        ))
      ) : (
        <span className="host-title small ellipsis">{title}</span>
      )}
    </div>
  );
  const close = (
    <button className="btn icon hbtn" aria-label="Close the branch" onClick={onClose}>
      <Icon name="close" size={15} />
    </button>
  );
  const up = onUp && (
    <button className="btn icon hbtn" aria-label="Up to the branch it came from" onClick={onUp}>
      <Icon name="back" size={15} />
    </button>
  );
  const crumbRow = crumbs && <p className="host-crumbs small muted ellipsis">{crumbs}</p>;
  const pane = (
    <div className="branch-pane" ref={paneRef} onScroll={onPaneScroll}>
      {crumbRow}
      {children}
    </div>
  );

  if (mode === "split") {
    return (
      <section ref={self} className={`branch-host split max-${max}`} aria-label="Branch" style={{ ["--split-h" as string]: `${splitHeight}px` }}>
        <div className="host-bar">
          {up}
          {tabRow}
          {modes}
          <button className="btn icon hbtn" aria-label={max === "none" ? "Branch full screen" : max === "branch" ? "Original full screen" : "Back to split"} onClick={onMax}>
            <Icon name="expand" size={15} />
          </button>
          {close}
        </div>
        {pane}
      </section>
    );
  }

  if (mode === "layer") {
    if (down)
      return (
        <section ref={self} className="branch-host layer down" aria-label="Branch">
          <button className="layer-bar" onClick={() => setDown(false)}>
            <Icon name="swap" size={15} /> <span className="ellipsis">{tabs.find((t) => t.active)?.label ?? ""} {tabs.find((t) => t.active)?.title ?? title}</span> <span aria-hidden>▴</span>
          </button>
        </section>
      );
    return (
      <section ref={self} className={`branch-host layer ${xray ? "xray" : ""}`} aria-label="Branch" style={{ background: bg }}>
        <div className="host-bar">
          {up}
          {tabRow}
          <button className="btn icon hbtn" aria-label="Show the original" onClick={() => setDown(true)}>
            <Icon name="swap" size={15} />
          </button>
          <SeeThrough level={see} onLevel={setSee} onXray={setXray} />
          {modes}
          {close}
        </div>
        {pane}
      </section>
    );
  }

  // bubble
  const active = tabs.find((t) => t.active);
  if (mini || !rect)
    return (
      <section ref={self} className="branch-host bubble-mini" aria-label="Branch">
        {rect && (
          <button className="bubble-dot" aria-label={`Open the branch ${active?.label ?? ""}`.trim()} onClick={() => setMini(false)}>
            {active?.label ?? "↳"}
          </button>
        )}
      </section>
    );
  return (
    <section
      ref={self}
      className={`branch-host bubble ${xray ? "xray" : ""}`}
      aria-label="Branch"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, background: bg }}
      onPointerMove={onDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div className="host-bar">
        <button className="btn icon hbtn grip" aria-label="Move the bubble" onPointerDown={startDrag("move")}>
          <Icon name="grip" size={15} />
        </button>
        {up}
        {tabs.length > 1 ? tabRow : <span className="host-title small ellipsis">{active ? `${active.label} ${active.title}` : title}</span>}
        <SeeThrough level={see} onLevel={setSee} onXray={setXray} />
        <button className="btn icon hbtn" aria-label="Bubble size" onClick={sizeNext}>
          <Icon name="size" size={15} />
        </button>
        <button className="btn icon hbtn" aria-label="Snap to the top or bottom" onClick={snap}>
          <Icon name="swap" size={15} />
        </button>
        <button className="btn icon hbtn" aria-label="Minimize the bubble" onClick={() => setMini(true)}>
          <Icon name="minus" size={15} />
        </button>
        <button className="btn icon hbtn" aria-label="Split screen" onClick={() => onMode("split")}>
          <Icon name="split" size={15} />
        </button>
        {close}
      </div>
      {pane}
      <button className="bubble-resize" aria-label="Resize the bubble" onPointerDown={startDrag("size")}>
        <Icon name="resize" size={14} />
      </button>
    </section>
  );
}

export type { BranchMode };
