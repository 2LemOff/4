import type { Answer } from "./answer";

export const LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/** Karpathy's format: the "FINAL RANKING:" section lists "1. Response C" lines, best first. */
export function parseRanking(text: string): string[] {
  const at = text.lastIndexOf("FINAL RANKING:");
  const part = at >= 0 ? text.slice(at) : text;
  const out: string[] = [];
  for (const m of part.matchAll(/\d+\.\s*Response ([A-Z])/g)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/** "Response C" / "C" → "C" */
export const labelOf = (s: string) => s.trim().replace(/^Response\s+/i, "").toUpperCase().slice(0, 1);

export interface Aggregate {
  label: string;
  model: string;
  avgRank: number;
  votes: number;
}

/** Average position per answer across all reviewers (lower is better). */
export function aggregateRankings(rankings: string[][], labelToModel: Record<string, string>): Aggregate[] {
  const pos = new Map<string, number[]>();
  for (const r of rankings) r.map(labelOf).forEach((l, i) => labelToModel[l] && pos.set(l, [...(pos.get(l) ?? []), i + 1]));
  return [...pos.entries()]
    .map(([label, ps]) => ({ label, model: labelToModel[label], avgRank: Math.round((ps.reduce((a, b) => a + b, 0) / ps.length) * 100) / 100, votes: ps.length }))
    .sort((a, b) => a.avgRank - b.avgRank);
}

export interface Verdict {
  id: string;
  supported: boolean;
  quote?: string;
}

/**
 * Grounding: a chairman point must name council answers it came from, and the verifier must find it in them.
 * Unsupported points are removed (with the links to them) or kept and flagged.
 */
export function applyGrounding(ans: Answer, labels: string[], verdicts: Verdict[], remove: boolean): { answer: Answer; unsupported: string[] } {
  const ok = new Set(labels);
  const verdict = new Map(verdicts.map((v) => [v.id, v.supported]));
  const unsupported = ans.nodes
    .filter((n) => !(n.sources ?? []).map(labelOf).some((l) => ok.has(l)) || verdict.get(n.id) === false)
    .map((n) => n.id);
  const bad = new Set(unsupported);
  if (!remove) {
    return { answer: { ...ans, nodes: ans.nodes.map((n) => ({ ...n, grounded: !bad.has(n.id) })) }, unsupported };
  }
  const nodes = ans.nodes.filter((n) => !bad.has(n.id)).map((n) => ({ ...n, grounded: true, from: n.from.filter((f) => !bad.has(f)) }));
  const usedGroups = new Set(nodes.map((n) => n.group).filter(Boolean));
  // keep categories that still hold something (directly or via sub-categories)
  const keep = new Set<string>();
  for (const g of ans.groups) {
    let cur: string | null = g.id;
    if (!usedGroups.has(g.id)) continue;
    while (cur && !keep.has(cur)) {
      keep.add(cur);
      cur = ans.groups.find((x) => x.id === cur)?.parent ?? null;
    }
  }
  return { answer: { ...ans, nodes, groups: ans.groups.filter((g) => keep.has(g.id)) }, unsupported };
}

// ── Full-text council ────────────────────────────────────────────────────────

export interface TaggedBlock {
  /** the block (paragraph, list item, heading…) without its source tags */
  text: string;
  /** labels of the member answers it came from */
  sources: string[];
}

// "[A, C]" anywhere, "(A, C)" only at the end of a line (so a "(I)" in prose stays)
const LABELS_IN = "((?:Response\\s+)?[A-Z](?:\\s*(?:,|and|&)\\s*(?:Response\\s+)?[A-Z])*)";
const TAG = new RegExp(`\\s*(?:\\[${LABELS_IN}\\]|\\(${LABELS_IN}\\)(?=[.,;:!?]?\\s*$))`, "g");
const tagLabels = (inner: string) => [...inner.matchAll(/(?:Response\s+)?\b([A-Z])\b/g)].map((m) => m[1]);

/**
 * The chairman ends every paragraph with the answers it came from ("… [A, C]"). Split the text into blocks
 * with their sources, and give back the text without the tags (what is shown and replayed).
 */
export function splitTagged(text: string): { blocks: TaggedBlock[] } {
  const blocks: TaggedBlock[] = [];
  let fence = false;
  let cur: { lines: string[]; sources: Set<string> } | undefined;
  const flush = () => {
    if (cur && cur.lines.join("").trim()) blocks.push({ text: cur.lines.join("\n").trim(), sources: [...cur.sources].sort() });
    cur = undefined;
  };
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*(```|~~~)/.test(raw)) fence = !fence;
    if (!fence && !raw.trim()) {
      flush();
      continue;
    }
    // a new list item or heading starts its own block
    if (!fence && /^\s*([-*+]|\d+[.)]|#{1,6})\s/.test(raw)) flush();
    cur ??= { lines: [], sources: new Set() };
    let line = raw;
    if (!fence) {
      for (const m of raw.matchAll(TAG)) for (const l of tagLabels(m[1] ?? m[2])) cur.sources.add(l);
      line = raw.replace(TAG, "").replace(/\s+([.,;:!?])/g, "$1").replace(/\s+$/, "");
    }
    cur.lines.push(line);
    // a heading is a block of its own
    if (!fence && /^\s*#{1,6}\s/.test(raw)) flush();
  }
  flush();
  return { blocks };
}

const STOP = new Set("about above after again also among because been before being below between both but could does doing down during each from further have having here hers herself himself into itself just more most myself only other ought ours over same should some such than that their theirs them themselves then there these they this those through under until very were what when where which while whom with would your yours yourself".split(" "));
/** Words that carry meaning: 4+ letters, not common filler. */
export function contentWords(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []).filter((w) => !STOP.has(w)));
}

/**
 * Member sentences the final answer left out: fewer than `min` of their meaningful words appear in it.
 * (A pure word check, so it works offline and costs nothing.)
 */
export function leftOut(members: { label: string; sentences: string[] }[], finalText: string, min = 0.6): { label: string; sentence: string }[] {
  const have = contentWords(finalText);
  const out: { label: string; sentence: string }[] = [];
  for (const m of members)
    for (const s of m.sentences) {
      const w = [...contentWords(s)];
      if (w.length < 3) continue;
      if (w.filter((x) => have.has(x)).length / w.length < min) out.push({ label: m.label, sentence: s });
    }
  return out;
}

/** How much the members' answers agree: the mean overlap of their meaningful words (0–1). */
export function agreement(texts: string[]): number {
  const sets = texts.map(contentWords).filter((s) => s.size);
  if (sets.length < 2) return 1;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < sets.length; i++)
    for (let j = i + 1; j < sets.length; j++) {
      const inter = [...sets[i]].filter((w) => sets[j].has(w)).length;
      sum += inter / Math.min(sets[i].size, sets[j].size);
      n++;
    }
  return Math.round((sum / n) * 100) / 100;
}

export const agreementLabel = (a: number) => (a >= 0.5 ? "high" : a >= 0.3 ? "medium" : "low");
