import { retry } from "../ai";
import type { Card } from "../types";

/** What went wrong with an answer, with the matching retries. Nothing is shown for a good answer. */
export function RetryNotice({ card }: { card: Card }) {
  const exhausted = card.error?.startsWith("Ran out of room");
  if (card.status === "error" && !exhausted) {
    return (
      <div className="notice error" role="alert">
        <p>{card.error ?? "Something went wrong."}</p>
        <button className="btn sm" onClick={() => retry(card.id)}>Retry</button>
      </div>
    );
  }
  if (card.status === "length" || exhausted) {
    return (
      <div className="notice error" role="alert">
        <p>{exhausted ? "Ran out of room while thinking." : "The answer was cut off at the token limit."}</p>
        <div className="chips">
          <button className="btn chip" onClick={() => retry(card.id, "more")}>More tokens</button>
          <button className="btn chip" onClick={() => retry(card.id, "lower")}>Lower effort</button>
          <button className="btn chip" onClick={() => retry(card.id)}>Retry</button>
        </div>
      </div>
    );
  }
  if (card.status === "refused") {
    return (
      <div className="notice error" role="alert">
        <p>The model declined to answer this.</p>
        <button className="btn sm" onClick={() => retry(card.id)}>Retry</button>
      </div>
    );
  }
  return null;
}
