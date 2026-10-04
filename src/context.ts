import type { Card } from "./types";
import type { CardIndex } from "./tree";
import { pathToRoot } from "./tree";
import { splitBlocks } from "./blocks";

export const FRESH_THRESHOLD = 0.7;

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1e6) return `${Math.round(n / 1000)}k`;
  return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
}

export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

export interface Meter {
  used: number;
  limit: number;
  ratio: number;
  label: string;
  level: "ok" | "warn";
}

/** Tokens held by a branch: the last finished response on the path reports prompt + completion exactly. */
export function branchTokens(idx: CardIndex, cardId: string, draft = ""): number {
  const path = pathToRoot(idx, cardId);
  let used = 0;
  for (const c of path) if (c.usage) used = c.usage.prompt + c.usage.completion;
  return used + estimateTokens(draft);
}

export function meter(used: number, limit: number): Meter {
  const ratio = limit > 0 ? used / limit : 0;
  return {
    used,
    limit,
    ratio,
    label: `${formatTokens(used)} / ${limit ? formatTokens(limit) : "?"}`,
    level: ratio >= FRESH_THRESHOLD ? "warn" : "ok",
  };
}

export const shouldOfferFresh = (m: Meter) => m.level === "warn";

/** A fresh-branch "portal" root card: its answer is a summary of the path it continues. */
export function makeFreshCard(from: Card, summary: string, id: string, now: number): Card {
  const what = from.anchor?.text ?? from.question;
  return {
    id,
    sessionId: from.sessionId,
    parentId: null,
    question: `Continue from: ${what}`,
    blocks: splitBlocks(summary),
    assistant: { content: summary },
    model: from.model,
    status: "done",
    portalFrom: from.id,
    createdAt: now,
  };
}
