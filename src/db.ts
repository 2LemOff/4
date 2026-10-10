import Dexie, { type Table } from "dexie";
import type { Bookmark, Card, Highlight, MediaRecord, Outline, Session, Visual } from "./types";
import type { Story } from "./storyTypes";
import { quantize } from "./search";

export interface VectorRecord {
  cardId: string;
  blockIdx: number;
  model: string;
  /** Int8 since v2 (cosine similarity ignores the scale); Float32 in v1 data */
  vector: Int8Array | Float32Array;
}

export class FractalDB extends Dexie {
  sessions!: Table<Session, string>;
  cards!: Table<Card, string>;
  outlines!: Table<Outline, string>;
  vectors!: Table<VectorRecord, [string, number]>;
  kv!: Table<{ key: string; value: unknown }, string>;
  bookmarks!: Table<Bookmark, string>;
  stories!: Table<Story, string>;
  media!: Table<MediaRecord, string>;
  highlights!: Table<Highlight, string>;
  visuals!: Table<Visual, string>;

  constructor(name = "fractal") {
    super(name);
    this.version(1).stores({
      sessions: "id,updatedAt",
      cards: "id,sessionId,parentId",
      outlines: "id,sessionId,category,createdAt",
      vectors: "[cardId+blockIdx],cardId",
      kv: "key",
    });
    this.version(2)
      .stores({
        bookmarks: "id,sessionId,cardId,createdAt",
        stories: "id,sessionId,cardId,createdAt",
        media: "id,sessionId,storyId,kind,createdAt",
      })
      .upgrade((tx) =>
        tx
          .table("vectors")
          .toCollection()
          .modify((v: VectorRecord) => {
            if (v.vector instanceof Float32Array) v.vector = quantize(v.vector);
          }),
      );
    // v3: words highlighted in chat answers
    this.version(3).stores({ highlights: "id,sessionId,cardId,createdAt" });
    // v4: saved visuals of answers and selections
    this.version(4).stores({ visuals: "id,sessionId,cardId,scopeKey,createdAt" });
  }
}

export const db = new FractalDB();

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await db.kv.get(key))?.value as T | undefined;
}
export const kvSet = (key: string, value: unknown) => db.kv.put({ key, value });

export const uid = () => crypto.randomUUID().slice(0, 8);
