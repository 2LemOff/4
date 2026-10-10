import { useMemo, useState } from "react";
import { db } from "../db";
import { suggestViews, VIEW_INFO, type ViewId } from "../diagrams";
import { go, hrefStory, hrefVisual } from "../route";
import { splitSources } from "../split";
import { useLive } from "../store";
import { createStory } from "../stories";
import type { VisualScope } from "../types";
import { openVisual, scopeKey, scopeSources } from "../visuals";
import { Sheet } from "./Sheet";

/**
 * What to see a scope as (a whole answer, one or several highlights, a branch, the whole topic). The views that
 * fit the text best come first; ones already made for this scope reopen without a new request.
 */
export function VisualizeSheet({ sessionId, cardId, scope, onClose }: { sessionId: string; cardId: string; scope: VisualScope; onClose: () => void }) {
  const data = useLive(async () => ({
    cards: await db.cards.where("sessionId").equals(sessionId).toArray(),
    highlights: await db.highlights.where("sessionId").equals(sessionId).toArray(),
    saved: (await db.visuals.where("scopeKey").equals(scopeKey(scope)).toArray()).find((v) => v.sessionId === sessionId),
  }), [sessionId, scopeKey(scope)]);
  const [busy, setBusy] = useState(false);
  const sentences = useMemo(() => (data ? splitSources(scopeSources(scope, data.cards, data.highlights).sources) : []), [data, scope]);
  const order = useMemo(() => suggestViews(sentences, { highlights: scope.highlightIds?.length }), [sentences, scope]);
  const best = new Set(order.slice(0, order.indexOf("bigidea") > 0 ? order.indexOf("bigidea") : 0));
  const ready = (v: ViewId): boolean => {
    const s = data?.saved;
    if (!s) return false;
    const kind = VIEW_INFO[v].kind;
    if (kind === "arranged") return s.arrangement?.status === "done";
    if (v === "sketch") return s.sketch?.status === "done";
    return !!s.diagrams[v as keyof typeof s.diagrams] && s.diagrams[v as keyof typeof s.diagrams]?.status === "done";
  };

  const open = async (v: ViewId) => {
    setBusy(true);
    try {
      if (v === "story") {
        const material = sentences.map((s) => s.text).join(" ");
        const id = await createStory(
          scope.kind === "answer" || scope.kind === "branch"
            ? { sessionId, cardId, scope: scope.kind }
            : { sessionId, cardId, scope: "text", material },
        );
        onClose();
        go(hrefStory(id));
        return;
      }
      const id = await openVisual(sessionId, cardId, scope);
      onClose();
      go(hrefVisual(id, v));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title="Visualize" onClose={onClose}>
      <p className="small">
        <strong>{scope.label}</strong>
        <span className="muted"> · {sentences.length} sentence{sentences.length === 1 ? "" : "s"}, all kept word for word</span>
      </p>
      <div className="view-grid" role="list">
        {order.map((v) => (
          <button key={v} role="listitem" className={`view-pick ${best.has(v) ? "best" : ""}`} disabled={busy || !sentences.length} onClick={() => open(v)}>
            <strong>{VIEW_INFO[v].label}</strong>
            <span className="muted small">{VIEW_INFO[v].about}</span>
            {best.has(v) && <span className="vbadge">Fits best</span>}
            {ready(v) && <span className="vbadge">Saved</span>}
          </button>
        ))}
      </div>
    </Sheet>
  );
}
