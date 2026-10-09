import { outlineLines, type Answer } from "../answer";
import type { Card } from "../types";
import { BookmarkButton } from "./BookmarkButton";

const KIND = { foundation: "Foundation", step: "Step", conclusion: "Conclusion" } as const;

/** The same pyramids as a readable, indented list. Every line can be selected. */
export function OutlineView({
  card,
  answer,
  childCards,
  selected,
  bookmarked,
  onTapNode,
  onTapGroup,
  onFocusCard,
}: {
  card: Card;
  answer: Answer | undefined;
  childCards: Card[];
  selected: Set<string>;
  bookmarked: Set<string>;
  onTapNode: (id: string) => void;
  onTapGroup: (id: string) => void;
  onFocusCard: (id: string) => void;
}) {
  const lines = answer ? outlineLines(answer) : [];
  const titles = new Map(answer?.nodes.filter((n) => n.title).map((n) => [n.id, n.title!]) ?? []);
  return (
    <div className="scroll pad outline-view">
      {card.anchor && <blockquote className="anchor">{card.anchor.quotes?.length ? card.anchor.quotes.join(" · ") : card.anchor.text}</blockquote>}
      <h1 className="question clamp">{card.question}</h1>
      {answer?.converted && <p className="muted small">This answer wasn't in pyramid form, so its paragraphs are shown as a chain.</p>}
      {card.status === "streaming" && !lines.length && <p className="muted pulse">Thinking…</p>}
      <ul className="outline">
        {lines.map((l, i) =>
          l.groupId ? (
            <li key={i} style={{ paddingLeft: l.depth * 14 }}>
              <button className={`outline-group ${selected.has(l.groupId) ? "on" : ""}`} onClick={() => onTapGroup(l.groupId!)}>
                {l.text}
              </button>
            </li>
          ) : (
            <li key={i} style={{ paddingLeft: l.depth * 14 }} className="outline-row">
              <button className={`outline-node ${l.kind} ${selected.has(l.nodeId!) ? "on" : ""}`} onClick={() => onTapNode(l.nodeId!)} aria-pressed={selected.has(l.nodeId!)}>
                <span className="kind-badge">{KIND[l.kind!]}</span>
                {titles.get(l.nodeId!) && <strong> {titles.get(l.nodeId!)}: </strong>}
                {l.text}
              </button>
              <BookmarkButton on={bookmarked.has(l.nodeId!)} sessionId={card.sessionId} cardId={card.id} nodeId={l.nodeId} label={l.text} />
            </li>
          ),
        )}
      </ul>
      {childCards.length > 0 && (
        <section aria-label="Questions on this answer">
          <h2 className="section">Questions on this answer ({childCards.length})</h2>
          {childCards.map((k) => (
            <button key={k.id} className="row-btn" onClick={() => onFocusCard(k.id)}>
              <strong>{k.tag ?? k.question}</strong>
              <span className="muted small">{k.question}</span>
            </button>
          ))}
        </section>
      )}
    </div>
  );
}
