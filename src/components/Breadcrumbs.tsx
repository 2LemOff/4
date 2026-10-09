import { useEffect, useRef } from "react";
import { breadcrumbs, type CardIndex } from "../tree";

export function Breadcrumbs({ idx, cid, onPick }: { idx: CardIndex; sid: string; cid: string; onPick: (id: string) => void }) {
  const ref = useRef<HTMLElement>(null);
  const items = breadcrumbs(idx, cid);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [cid, items.length]);
  return (
    <nav className="crumbs" aria-label="Breadcrumbs" ref={ref}>
      {items.map((c, i) => (
        <span key={c.id} className="crumb-wrap">
          {i > 0 && <span className="muted" aria-hidden>›</span>}
          <button className={`crumb ${c.id === cid ? "on" : ""}`} aria-current={c.id === cid ? "page" : undefined} onClick={() => onPick(c.id)}>
            {c.label}
          </button>
        </span>
      ))}
    </nav>
  );
}
