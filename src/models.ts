import type { ModelInfo } from "./types";

export type PickerFamily =
  | "gemini-pro"
  | "gemini-flash"
  | "grok"
  | "openai"
  | "claude-opus"
  | "claude-fable"
  | "claude-sonnet";

export const PICKER_FAMILIES: { id: PickerFamily; label: string }[] = [
  { id: "gemini-pro", label: "Gemini Pro" },
  { id: "gemini-flash", label: "Gemini Flash" },
  { id: "grok", label: "Grok" },
  { id: "openai", label: "ChatGPT" },
  { id: "claude-opus", label: "Claude Opus" },
  { id: "claude-fable", label: "Claude Fable" },
  { id: "claude-sonnet", label: "Claude Sonnet" },
];

const NOISE = /image|audio|tts|embed|live|vision|search|moderation|customtools|:free|:extended|:thinking/i;

const MATCH: Record<PickerFamily, (m: ModelInfo) => boolean> = {
  "gemini-pro": (m) => /^google\/gemini-.*pro/.test(m.id) && !NOISE.test(m.id),
  "gemini-flash": (m) => /^google\/gemini-.*flash/.test(m.id) && !/lite/.test(m.id) && !NOISE.test(m.id),
  grok: (m) => /^x-ai\/grok/.test(m.id) && !/code/.test(m.id) && !NOISE.test(m.id),
  openai: (m) =>
    /^openai\/(gpt-|o\d)/.test(m.id) && !/mini|nano|codex|chat|-pro$|oss/.test(m.id) && !NOISE.test(m.id),
  "claude-opus": (m) => /^anthropic\/claude-opus/.test(m.id) && !NOISE.test(m.id),
  "claude-fable": (m) => /^anthropic\/claude-fable/.test(m.id) && !NOISE.test(m.id),
  "claude-sonnet": (m) => /^anthropic\/claude-sonnet/.test(m.id) && !NOISE.test(m.id),
};

const isText = (m: ModelInfo) =>
  !m.architecture?.output_modalities || m.architecture.output_modalities.includes("text");

const newestFirst = (a: ModelInfo, b: ModelInfo) =>
  (b.created ?? 0) - (a.created ?? 0) || b.id.localeCompare(a.id);

/** Variants such as `:batch`, `:free` or `:nitro` are never picked as a family's default. */
const isVariant = (m: ModelInfo) => m.id.includes(":");

/** The newest models of a picker family, newest first. */
export function familyModels(models: ModelInfo[], family: PickerFamily, limit = 6): ModelInfo[] {
  return models.filter((m) => isText(m) && !isVariant(m) && MATCH[family](m)).sort(newestFirst).slice(0, limit);
}

export function newestOf(models: ModelInfo[], family: PickerFamily): ModelInfo | undefined {
  return familyModels(models, family, 1)[0];
}

export interface RoleDefaults {
  answer?: string;
  tags?: string;
  rerank?: string;
}

/** Defaults per role: newest Gemini Pro answers, newest Gemini Flash tags, newest Claude Sonnet reranks. */
export function roleDefaults(models: ModelInfo[]): RoleDefaults {
  const any = models.filter((m) => isText(m) && !isVariant(m)).sort(newestFirst)[0]?.id;
  return {
    answer: newestOf(models, "gemini-pro")?.id ?? any,
    tags: newestOf(models, "gemini-flash")?.id ?? newestOf(models, "gemini-pro")?.id ?? any,
    rerank: newestOf(models, "claude-sonnet")?.id ?? newestOf(models, "gemini-pro")?.id ?? any,
  };
}

/** Default council: the newest Gemini Pro, Claude Opus, ChatGPT and Grok that exist. */
export function councilDefaults(models: ModelInfo[]): string[] {
  return (["gemini-pro", "claude-opus", "openai", "grok"] as PickerFamily[]).map((f) => newestOf(models, f)?.id).filter((x): x is string => !!x);
}

export function defaultEmbeddingModel(models: ModelInfo[]): string | undefined {
  return (
    models.find((m) => m.id === "openai/text-embedding-3-small")?.id ??
    [...models].sort(newestFirst)[0]?.id
  );
}

export function priceLabel(m: ModelInfo): string {
  const p = Number(m.pricing?.prompt);
  const c = Number(m.pricing?.completion);
  if (!isFinite(p) || !isFinite(c)) return "";
  const per = (x: number) => (x * 1e6 < 100 ? (x * 1e6).toFixed(2) : (x * 1e6).toFixed(0));
  return `$${per(p)} / $${per(c)} per 1M`;
}
