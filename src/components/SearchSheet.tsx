import { useMemo, useState } from "react";
import { searchConcepts, type SearchOutcome } from "../ai";
import { db } from "../db";
import { go, hrefCard } from "../route";
import { useLive } from "../store";
import { breadcrumbs, indexCards } from "../tree";
import { Sheet } from "./Sheet";

export function SearchSheet({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<SearchOutcome | null>(null);
  const cards = useLive(() => db.cards.toArray(), []);
  const idx = useMemo(() => indexCards(cards ?? []), [cards]);

  const run = async () => {
    if (!q.trim()) return;
    setBusy(true);
    try {
      setOut(await searchConcepts(q));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title="Search by concept" onClose={onClose}>
      <form className="composer-row" onSubmit={(e) => { e.preventDefault(); void run(); }}>
        <input className="input grow" autoFocus placeholder="e.g. Where did I ask about observers?" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search query" enterKeyHint="search" />
        <button className="btn primary" type="submit" disabled={busy || !q.trim()}>{busy ? "…" : "Search"}</button>
      </form>
      {out?.note && <p className="muted small">{out.note}</p>}
      {out && out.mode !== "keyword" && <p className="muted small">{out.mode === "rerank" ? "Best matches by meaning" : "Matches by meaning"}</p>}
      {out && !out.results.length && <p className="muted">Nothing found.</p>}
      {out?.results.map((r) => {
        const card = idx.get(r.cardId);
        if (!card) return null;
        const path = breadcrumbs(idx, r.cardId).map((c) => c.label).join(" › ");
        return (
          <button key={r.cardId} className="row-btn" onClick={() => { go(hrefCard(card.sessionId, card.id, r.blockIdx)); onClose(); }}>
            <span className="small muted">{path}</span>
            <span>{r.text.length > 160 ? r.text.slice(0, 160) + "…" : r.text}</span>
            {r.why && <span className="small muted">{r.why}</span>}
          </button>
        );
      })}
    </Sheet>
  );
}
