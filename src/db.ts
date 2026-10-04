import Dexie, { type Table } from "dexie";
import type { Card, Outline, Session } from "./types";

export interface VectorRecord {
  cardId: string;
  blockIdx: number;
  model: string;
  vector: Float32Array;
}

export class FractalDB extends Dexie {
  sessions!: Table<Session, string>;
  cards!: Table<Card, string>;
  outlines!: Table<Outline, string>;
  vectors!: Table<VectorRecord, [string, number]>;
  kv!: Table<{ key: string; value: unknown }, string>;

  constructor(name = "fractal") {
    super(name);
    this.version(1).stores({
      sessions: "id,updatedAt",
      cards: "id,sessionId,parentId",
      outlines: "id,sessionId,category,createdAt",
      vectors: "[cardId+blockIdx],cardId",
      kv: "key",
    });
  }
}

export const db = new FractalDB();

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await db.kv.get(key))?.value as T | undefined;
}
export const kvSet = (key: string, value: unknown) => db.kv.put({ key, value });

export const uid = () => crypto.randomUUID().slice(0, 8);
