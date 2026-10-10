import type { Anchor, Card, QuoteFrom, ReasoningDetail } from "./types";

export type CardIndex = Map<string, Card>;
export const indexCards = (cards: Card[]): CardIndex => new Map(cards.map((c) => [c.id, c]));

/** Cards from the root down to (and including) `id`. */
export function pathToRoot(idx: CardIndex, id: string): Card[] {
  const out: Card[] = [];
  const seen = new Set<string>();
  let cur = idx.get(id);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.push(cur);
    cur = cur.parentId ? idx.get(cur.parentId) : undefined;
  }
  return out.reverse();
}

export function children(idx: CardIndex, id: string): Card[] {
  return [...idx.values()]
    .filter((c) => c.parentId === id)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** Cards sharing this card's parent (including itself), oldest first. A root has no siblings. */
export function siblings(idx: CardIndex, id: string): Card[] {
  const c = idx.get(id);
  if (!c) return [];
  if (!c.parentId) return [c];
  return children(idx, c.parentId);
}

/**
 * The card a chat shows last when opened at `id`: `preferred` (the branch you were on) when it lies below `id`,
 * otherwise the newest answer at every level below `id`.
 */
export function leafFrom(idx: CardIndex, id: string, preferred?: string): string {
  if (preferred && preferred !== id && idx.has(preferred) && pathToRoot(idx, preferred).some((c) => c.id === id)) return preferred;
  let cur = id;
  for (let guard = 0; guard < 10_000; guard++) {
    const kids = children(idx, cur);
    if (!kids.length) break;
    cur = kids[kids.length - 1].id;
  }
  return cur;
}

/** Cards whose question was asked about each highlight (highlight id → count). */
export function highlightBranches(cards: Card[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of cards) for (const h of c.anchor?.highlightIds ?? []) m.set(h, (m.get(h) ?? 0) + 1);
  return m;
}

/** Every card as a row of the branch tree (depth-first, oldest first), for the Branches list. */
export function treeRows(idx: CardIndex): { card: Card; depth: number }[] {
  const out: { card: Card; depth: number }[] = [];
  const roots = [...idx.values()].filter((c) => !c.parentId || !idx.has(c.parentId)).sort((a, b) => a.createdAt - b.createdAt);
  const seen = new Set<string>();
  const walk = (c: Card, depth: number) => {
    if (seen.has(c.id)) return;
    seen.add(c.id);
    out.push({ card: c, depth });
    for (const k of children(idx, c.id)) walk(k, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  return out;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  /** pictures sent with this turn (data URLs); turned into image parts when the request is made */
  images?: string[];
  reasoning?: string;
  reasoning_details?: ReasoningDetail[];
  configuration_update?: { reasoning: { effort: string } };
}

/** A question about highlighted words: one quote, or several numbered quotes sent as one prompt. */
export function highlightTurn(quotes: string[], question: string, from?: QuoteFrom[]): string {
  const pic = (i: number) => from?.[i] === "picture";
  const all = quotes.every((_, i) => pic(i));
  if (quotes.length === 1) return `About this part of ${all ? "the text in my picture" : "your previous answer"}: "${quotes[0]}"\n\nMy question: ${question}`;
  const head = all ? "the text in my pictures" : quotes.some((_, i) => pic(i)) ? "our conversation" : "your previous answers";
  const mixed = !all && quotes.some((_, i) => pic(i));
  return `About these parts of ${head}:\n${quotes.map((t, i) => `${i + 1}. "${t}"${mixed && pic(i) ? " (from my picture)" : ""}`).join("\n")}\n\nMy question: ${question}`;
}

export function userTurn(anchor: Anchor | undefined, question: string, seq?: number): string {
  let q = question;
  if (anchor && anchor.scope === "highlights" && anchor.quotes?.length) q = highlightTurn(anchor.quotes, question, anchor.quoteFrom);
  else if (anchor && anchor.scope === "pyramid") q = `About this pyramid from your previous answer:\n${anchor.text}\n\nMy question: ${question}`;
  else if (anchor && anchor.scope === "category") q = `About this category from your previous answer:\n${anchor.text}\n\nMy question: ${question}`;
  else if (anchor && anchor.quotes && anchor.quotes.length > 1)
    q = `About these points from your previous answers:\n${anchor.quotes.map((t) => `- "${t}"`).join("\n")}\n\nMy question: ${question}`;
  else if (anchor && anchor.nodeIds) q = `About this point from your previous answer: "${anchor.text}"\n\nMy question: ${question}`;
  else if (anchor) q = `About this statement from your previous answer: "${anchor.text}"\n\nMy question: ${question}`;
  return seq !== undefined ? `${q}\n\n(Answer id prefix: K${seq})` : q;
}

export interface BuildOptions {
  systemPrompt: string;
  /** the model that will answer: reasoning is replayed only for turns it produced */
  model: string;
  /** include stored configuration_update messages (only for models that accept them) */
  includeConfigUpdates?: boolean;
  /** effort change for the new question */
  newConfigUpdate?: { effort: string };
  /** pictures of earlier turns (by card id) and of the new question, replayed in their own turn */
  images?: (cardId: string) => string[] | undefined;
  newImages?: string[];
  /** for models that can't see pictures: text added to a turn instead (by card id, and for the new question) */
  imageText?: (cardId: string) => string | undefined;
  newImageText?: string;
}

/**
 * Messages for a new question asked under `parentId` (null for a new root). The ancestor path is replayed
 * verbatim, so every branch is append-only: the prefix for a child is exactly the parent's messages plus
 * the parent's answer.
 */
export function buildMessages(
  idx: CardIndex,
  parentId: string | null,
  question: string,
  anchor: Anchor | undefined,
  opts: BuildOptions,
  seq?: number,
): ChatMessage[] {
  const msgs: ChatMessage[] = [{ role: "system", content: opts.systemPrompt }];
  const path = parentId ? pathToRoot(idx, parentId) : [];
  for (const c of path) {
    if (!c.assistant) continue;
    if (opts.includeConfigUpdates && c.configUpdate) {
      msgs.push({ role: "system", content: "", configuration_update: { reasoning: { effort: c.configUpdate.effort } } });
    }
    const imgs = opts.images?.(c.id);
    const note = opts.imageText?.(c.id);
    const turn = note ? `${userTurn(c.anchor, c.question, c.seq)}\n\n${note}` : userTurn(c.anchor, c.question, c.seq);
    msgs.push(imgs?.length ? { role: "user", content: turn, images: imgs } : { role: "user", content: turn });
    const a: ChatMessage = { role: "assistant", content: c.assistant.content };
    if (c.model === opts.model) {
      if (c.assistant.reasoning_details?.length) a.reasoning_details = c.assistant.reasoning_details;
      else if (c.assistant.reasoning) a.reasoning = c.assistant.reasoning;
    }
    msgs.push(a);
  }
  if (opts.includeConfigUpdates && opts.newConfigUpdate) {
    msgs.push({ role: "system", content: "", configuration_update: { reasoning: { effort: opts.newConfigUpdate.effort } } });
  }
  const last = opts.newImageText ? `${userTurn(anchor, question, seq)}\n\n${opts.newImageText}` : userTurn(anchor, question, seq);
  msgs.push(opts.newImages?.length ? { role: "user", content: last, images: opts.newImages } : { role: "user", content: last });
  return msgs;
}

/** Drilled sentences of a card: how many child cards were asked about each (blockIdx, sentenceIdx). */
export function drillCounts(idx: CardIndex, id: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of children(idx, id)) {
    if (!c.anchor || c.anchor.blockIdx === undefined) continue;
    const k = `${c.anchor.blockIdx}:${c.anchor.sentenceIdx}`;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

/** Breadcrumb trail: root → current card with their tags. */
export function breadcrumbs(idx: CardIndex, id: string): { id: string; label: string }[] {
  return pathToRoot(idx, id).map((c) => ({
    id: c.id,
    label: c.tag || (c.anchor?.text ?? c.question).slice(0, 24),
  }));
}
