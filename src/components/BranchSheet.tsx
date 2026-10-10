import { short } from "../answer";
import { treeRows, type CardIndex } from "../tree";
import type { Card } from "../types";
import { Sheet } from "./Sheet";

const label = (c: Card) => {
  const q = c.anchor?.quotes?.length ? c.anchor.quotes : c.anchor ? [c.anchor.text] : [];
  return q.length ? `↳ “${short(q[0], 40)}”${q.length > 1 ? ` +${q.length - 1}` : ""} · ${short(c.question, 50)}` : short(c.question, 80);
};

/** Every question in the topic as an indented tree; the branch on screen is bold. */
export function BranchSheet({ idx, path, onPick, onClose }: { idx: CardIndex; path: Set<string>; onPick: (id: string) => void; onClose: () => void }) {
  const rows = treeRows(idx);
  return (
    <Sheet title="Branches" onClose={onClose}>
      <p className="muted small">Each question starts a branch. The one you are reading is in bold.</p>
      <ul className="branch-list">
        {rows.map(({ card, depth }) => (
          <li key={card.id} style={{ paddingLeft: Math.min(depth, 6) * 14 }}>
            <button
              className={`row-btn compact ${path.has(card.id) ? "on" : ""}`}
              aria-current={path.has(card.id) ? "true" : undefined}
              onClick={() => onPick(card.id)}
            >
              <span className={path.has(card.id) ? "strong" : ""}>{label(card)}</span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
