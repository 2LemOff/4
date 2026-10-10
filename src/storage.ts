import { db } from "./db";
import type { MediaKind } from "./types";

export async function isPersisted(): Promise<boolean | undefined> {
  return navigator.storage?.persisted ? navigator.storage.persisted() : undefined;
}

/** Ask the browser not to clear Fractal's data when the phone runs low on space. */
export async function requestPersist(): Promise<boolean | undefined> {
  return navigator.storage?.persist ? navigator.storage.persist() : undefined;
}

export async function estimate(): Promise<{ usage?: number; quota?: number }> {
  return navigator.storage?.estimate ? navigator.storage.estimate() : {};
}

export const bytes = (s: string) => new TextEncoder().encode(s).length;

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

export interface TopicUsage {
  sessionId: string;
  title: string;
  text: number;
  index: number;
  audio: number;
  image: number;
  video: number;
  total: number;
}

export interface FileInfo {
  id: string;
  sessionId: string;
  storyId?: string;
  kind: MediaKind;
  label: string;
  size: number;
  createdAt: number;
}

/** Sizes per topic and per type. */
export async function usageBreakdown(): Promise<{ topics: TopicUsage[]; files: FileInfo[] }> {
  const [sessions, cards, outlines, vectors, stories, media, bookmarks] = await Promise.all([
    db.sessions.toArray(),
    db.cards.toArray(),
    db.outlines.toArray(),
    db.vectors.toArray(),
    db.stories.toArray(),
    db.media.toArray(),
    db.bookmarks.toArray(),
  ]);
  const cardSession = new Map(cards.map((c) => [c.id, c.sessionId]));
  const topics = new Map<string, TopicUsage>(
    sessions.map((s) => [s.id, { sessionId: s.id, title: s.title, text: bytes(JSON.stringify(s)), index: 0, audio: 0, image: 0, video: 0, total: 0 }]),
  );
  const add = (sid: string | undefined, key: keyof Omit<TopicUsage, "sessionId" | "title" | "total">, n: number) => {
    const t = sid ? topics.get(sid) : undefined;
    if (t) t[key] += n;
  };
  for (const c of cards) add(c.sessionId, "text", bytes(JSON.stringify(c)));
  for (const o of outlines) add(o.sessionId, "text", bytes(JSON.stringify(o)));
  for (const s of stories) add(s.sessionId, "text", bytes(JSON.stringify(s)));
  for (const b of bookmarks) add(b.sessionId, "text", bytes(JSON.stringify(b)));
  for (const v of vectors) add(cardSession.get(v.cardId), "index", v.vector.byteLength + 40);
  for (const m of media) add(m.sessionId, m.kind, m.size);
  for (const t of topics.values()) t.total = t.text + t.index + t.audio + t.image + t.video;
  const files: FileInfo[] = media
    .map(({ id, sessionId, storyId, kind, label, size, createdAt }) => ({ id, sessionId, storyId, kind, label, size, createdAt }))
    .sort((a, b) => b.size - a.size);
  return { topics: [...topics.values()].sort((a, b) => b.total - a.total), files };
}

/** Delete chosen files. Stories keep their text and show "Regenerate" for what was removed. */
export async function deleteMedia(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const gone = new Set(ids);
  const media = (await db.media.bulkGet(ids)).filter((m): m is NonNullable<typeof m> => !!m);
  const storyIds = [...new Set(media.map((m) => m.storyId).filter((x): x is string => !!x))];
  await db.transaction("rw", db.media, db.stories, async () => {
    await db.media.bulkDelete(ids);
    for (const sid of storyIds) {
      const st = await db.stories.get(sid);
      if (!st) continue;
      st.slides = st.slides.map((s) => {
        const next = { ...s };
        if (s.audioId && gone.has(s.audioId)) Object.assign(next, { audioId: undefined, audioStatus: "pending" });
        if (s.imageId && gone.has(s.imageId)) Object.assign(next, { imageId: undefined, pictureStatus: s.picture === "image" ? "pending" : s.pictureStatus });
        if (s.videoId && gone.has(s.videoId)) Object.assign(next, { videoId: undefined, pictureStatus: s.picture === "video" ? "pending" : s.pictureStatus });
        return next;
      });
      await db.stories.put(st);
    }
  });
}

/** Delete whole topics with everything that belongs to them. */
export async function deleteTopics(sessionIds: string[]): Promise<void> {
  for (const sid of sessionIds) {
    const cardIds = (await db.cards.where("sessionId").equals(sid).primaryKeys()) as string[];
    await db.transaction("rw", [db.sessions, db.cards, db.outlines, db.vectors, db.bookmarks, db.stories, db.media, db.highlights, db.visuals, db.quicks, db.checks], async () => {
      await db.cards.bulkDelete(cardIds);
      await db.vectors.where("cardId").anyOf(cardIds).delete();
      await db.outlines.where("sessionId").equals(sid).delete();
      await db.bookmarks.where("sessionId").equals(sid).delete();
      await db.highlights.where("sessionId").equals(sid).delete();
      await db.visuals.where("sessionId").equals(sid).delete();
      await db.quicks.where("sessionId").equals(sid).delete();
      await db.checks.where("sessionId").equals(sid).delete();
      await db.stories.where("sessionId").equals(sid).delete();
      await db.media.where("sessionId").equals(sid).delete();
      await db.sessions.delete(sid);
    });
  }
}
