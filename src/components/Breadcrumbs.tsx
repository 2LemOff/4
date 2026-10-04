import { useEffect, useRef } from "react";
import { go, hrefCard } from "../route";
import { breadcrumbs, type CardIndex } from "../tree";

export function Breadcrumbs({ idx, sid, cid }: { idx: CardIndex; sid: string; cid: string }) {
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
          <button className={`btn chip crumb ${c.id === cid ? "on" : ""}`} aria-current={c.id === cid ? "page" : undefined} onClick={() => go(hrefCard(sid, c.id))}>
            {c.label}
          </button>
        </span>
      ))}
    </nav>
  );
}
