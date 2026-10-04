import type { Effort } from "./types";

export const ANSWER_ROOM = 4096;
export const DEFAULT_MAX_TOKENS = 16000;

const RATIO: Record<Effort, number> = {
  max: 0.95,
  xhigh: 0.95,
  high: 0.8,
  medium: 0.5,
  low: 0.2,
  minimal: 0.1,
  none: 0,
};

/** budget_tokens OpenRouter derives for Anthropic models from an effort level. */
export function anthropicBudget(effort: Effort, maxTokens: number): number {
  return Math.round(Math.max(Math.min(maxTokens * RATIO[effort], 128000), 1024));
}

export type ReasoningKind =
  | { kind: "default" }
  | { kind: "off" }
  | { kind: "effort"; effort: Effort }
  | { kind: "budget"; budget: number };

/** max_tokens for a request: always strictly above the reasoning budget, with room for the answer. */
export function requestMaxTokens(opts: {
  claude: boolean;
  userMax?: number;
  reasoning: ReasoningKind;
}): number {
  const base = opts.userMax ?? DEFAULT_MAX_TOKENS;
  const r = opts.reasoning;
  if (r.kind === "budget") return Math.max(base, r.budget + ANSWER_ROOM);
  if (opts.claude && r.kind === "effort") {
    let m = base;
    for (let i = 0; i < 6; i++) {
      const budget = anthropicBudget(r.effort, m);
      if (m - budget >= ANSWER_ROOM) return m;
      m = Math.ceil(budget + ANSWER_ROOM + 1);
      if (RATIO[r.effort] < 1) m = Math.max(m, Math.ceil(ANSWER_ROOM / (1 - RATIO[r.effort])));
    }
    return m;
  }
  return base;
}

/** True when reasoning ate (almost) the whole max_tokens budget and no visible answer remains. */
export function reasoningExhausted(
  usage: { completion_tokens?: number; reasoning_tokens?: number } | undefined,
  finishReason: string | null | undefined,
): boolean {
  if (finishReason !== "length" || !usage) return false;
  const visible = (usage.completion_tokens ?? 0) - (usage.reasoning_tokens ?? 0);
  return visible <= 2;
}

function version(id: string, re: RegExp): [number, number] | null {
  const m = id.match(re);
  if (!m) return null;
  return [Number(m[1]), m[2] !== undefined ? Number(m[2]) : 0];
}
const gte = (v: [number, number] | null, major: number, minor = 0) =>
  !!v && (v[0] > major || (v[0] === major && v[1] >= minor));

const bare = (id: string) => id.replace(/^~/, "");

/** OpenAI GPT-5.6 and newer (pro mode, reasoning context, verbosity). */
export function isGpt56Plus(id: string): boolean {
  const i = bare(id);
  return i.startsWith("openai/") && gte(version(i, /gpt-(\d+)(?:\.(\d+))?/), 5, 6);
}
export const isOpenAIPro = isGpt56Plus;

/** Models known to accept a mid-conversation effort change (Claude Fable 5.1+, Claude Opus 5+, GPT-6+). */
export function canUseConfigUpdate(id: string, blocked: string[] = []): boolean {
  const i = bare(id);
  if (blocked.includes(id)) return false;
  if (i.startsWith("anthropic/")) {
    return (
      gte(version(i, /claude-fable-(\d+)(?:[.-](\d+))?/), 5, 1) ||
      gte(version(i, /claude-opus-(\d+)(?:[.-](\d+))?/), 5, 0)
    );
  }
  if (i.startsWith("openai/")) return gte(version(i, /gpt-(\d+)(?:\.(\d+))?/), 6, 0);
  return false;
}
