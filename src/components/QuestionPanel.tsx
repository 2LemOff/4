import type { Card } from "../types";
import { BookmarkButton } from "./BookmarkButton";
import { ContextMeter } from "./ContextMeter";
import { Icon } from "./Icon";
import { shortName } from "./ModelPicker";
import { ReasoningPanel } from "./ReasoningPanel";
import { CouncilPanel } from "./CouncilPanel";
import { RetryNotice } from "./RetryNotice";

/** Details of one question and its answer: model, cost, memory used, reasoning, errors and retries. */
export function QuestionPanel({
  card,
  live,
  used,
  limit,
  bookmarked,
  childCards,
  onFresh,
  onFocusCard,
  onContinue,
  onClose,
}: {
  card: Card;
  live?: { reasoning: string };
  used: number;
  limit: number;
  bookmarked: boolean;
  childCards: Card[];
  onFresh: () => void;
  onFocusCard: (id: string) => void;
  onContinue: (model: string) => void;
  onClose: () => void;
}) {
  const streaming = card.status === "streaming";
  return (
    <section className="panel" aria-label="Question">
      <div className="panel-head">
        <span className="kind-badge">{card.mode === "council" ? "Council question" : "Question"}</span>
        <span className="grow" />
        <BookmarkButton on={bookmarked} sessionId={card.sessionId} cardId={card.id} label={card.tag ?? card.question} />
        <button className="btn icon sm" aria-label="Close" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      {card.anchor && <blockquote className="anchor">{card.anchor.quotes?.length ? card.anchor.quotes.join(" · ") : card.anchor.text}</blockquote>}
      <p className="panel-text">{card.question}</p>
      {streaming && <p className="muted pulse" role="status">Answering…</p>}
      <RetryNotice card={card} />
      {card.council && <CouncilPanel council={card.council} onContinue={onContinue} />}
      {!card.council && <ReasoningPanel assistant={card.assistant} live={streaming ? live?.reasoning : undefined} />}
      <p className="meta small muted">
        {shortName(card.model)}
        {card.usage?.cost !== undefined ? ` · $${card.usage.cost.toFixed(4)}` : ""}
        {card.usage?.reasoning ? ` · ${card.usage.reasoning.toLocaleString()} reasoning tokens` : ""}
      </p>
      <ContextMeter used={used} limit={limit} onFresh={onFresh} />
      {childCards.length > 0 && (
        <>
          <p className="muted small">Questions on this answer</p>
          {childCards.map((k) => (
            <button key={k.id} className="row-btn compact" onClick={() => onFocusCard(k.id)}>
              {k.tag ?? k.question}
            </button>
          ))}
        </>
      )}
    </section>
  );
}
