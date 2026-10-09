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
