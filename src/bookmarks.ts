import { db, uid } from "./db";
import type { Bookmark } from "./types";

export const bookmarkKey = (cardId: string, nodeId?: string) => `${cardId}|${nodeId ?? ""}`;

/** Add or remove a bookmark for a question/answer or a single point. Returns true when it is now saved. */
export async function toggleBookmark(b: Omit<Bookmark, "id" | "createdAt">): Promise<boolean> {
  const existing = (await db.bookmarks.where("cardId").equals(b.cardId).toArray()).find((x) => (x.nodeId ?? "") === (b.nodeId ?? ""));
  if (existing) {
    await db.bookmarks.delete(existing.id);
    return false;
  }
  await db.bookmarks.put({ ...b, id: uid(), createdAt: Date.now() });
  return true;
}
