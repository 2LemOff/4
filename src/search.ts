import type { Card } from "./types";

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export interface VectorRow {
  cardId: string;
  blockIdx: number; // -1 = header/question
  vector: ArrayLike<number>;
}

export interface Hit {
  cardId: string;
  blockIdx: number;
  score: number;
}

/** Best-matching block per card, top k cards. */
export function topCards(query: ArrayLike<number>, rows: VectorRow[], k = 20): Hit[] {
  const best = new Map<string, Hit>();
  for (const r of rows) {
    const score = cosine(query, r.vector);
    const cur = best.get(r.cardId);
    if (!cur || score > cur.score) best.set(r.cardId, { cardId: r.cardId, blockIdx: r.blockIdx, score });
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, k);
}

const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** Offline fallback: score cards by shared words (prefix matches count) over tag, question and blocks. */
export function keywordSearch(cards: Card[], query: string, k = 20): Hit[] {
  const q = words(query).filter((w) => w.length > 2);
  if (!q.length) return [];
  const hits: Hit[] = [];
  for (const c of cards) {
    const fields: [number, string][] = [
      [-1, `${c.tag ?? ""} ${c.anchor?.text ?? ""} ${c.question}`],
      ...c.blocks.map((b, i) => [i, b] as [number, string]),
    ];
    let best: Hit | null = null;
    for (const [i, text] of fields) {
      const ws = words(text);
      let score = 0;
      for (const w of q) if (ws.some((x) => x === w || x.startsWith(w) || w.startsWith(x))) score++;
      if (score && (!best || score > best.score)) best = { cardId: c.id, blockIdx: i, score: score / q.length };
    }
    if (best) hits.push(best);
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, k);
}

/** Text of the matching block (or the header when blockIdx is -1). */
export function hitText(c: Card, blockIdx: number): string {
  return blockIdx >= 0 && c.blocks[blockIdx] ? c.blocks[blockIdx] : (c.anchor?.text ?? c.question);
}
