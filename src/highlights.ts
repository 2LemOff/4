import { db, uid } from "./db";
import type { TextAnchor } from "./anchors";
import type { Highlight } from "./types";

/** Save highlighted words (an identical highlight on the same answer is reused). */
export async function saveHighlight(h: TextAnchor & { sessionId: string; cardId: string }): Promise<Highlight> {
  const same = (await db.highlights.where("cardId").equals(h.cardId).toArray()).find((x) => x.start === h.start && x.end === h.end && x.quote === h.quote);
  if (same) return same;
  const rec: Highlight = {
    id: uid(),
    sessionId: h.sessionId,
    cardId: h.cardId,
    quote: h.quote,
    start: h.start,
    end: h.end,
    prefix: h.prefix,
    suffix: h.suffix,
    createdAt: Date.now(),
  };
  await db.highlights.put(rec);
  return rec;
}

export const deleteHighlight = (id: string) => db.highlights.delete(id);
