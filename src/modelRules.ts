import { ALL_EFFORTS, type Effort, type ModelInfo, type ModelSettings } from "./types";
import {
  isGpt56Plus,
  requestMaxTokens,
  type ReasoningKind,
  canUseConfigUpdate,
} from "./reasoning";

export type Family = "claude" | "gemini" | "grok" | "openai" | "other";

export function familyOf(id: string): Family {
  const i = id.replace(/^~/, "");
  if (i.startsWith("anthropic/")) return "claude";
  if (i.startsWith("google/")) return "gemini";
  if (i.startsWith("x-ai/")) return "grok";
  if (i.startsWith("openai/")) return "openai";
  return "other";
}

export const GENERIC_PARAMS = [
  "temperature",
  "top_p",
  "top_k",
  "frequency_penalty",
  "presence_penalty",
  "repetition_penalty",
  "seed",
] as const;
export type GenericParam = (typeof GENERIC_PARAMS)[number];

export interface SettingsControls {
  family: Family;
  /** sampling-style controls this model lists in supported_parameters */
  generic: GenericParam[];
  verbosity: boolean;
  reasoning: {
    available: boolean;
    efforts: Effort[];
    defaultEffort?: Effort;
    defaultEnabled: boolean;
    canDisable: boolean;
    budget: boolean;
  };
  pro: boolean;
  contextMode: boolean;
  configUpdate: boolean;
  hints: string[];
}

const nearest = (effort: Effort, allowed: Effort[]): Effort => {
  if (allowed.includes(effort)) return effort;
  const idx = ALL_EFFORTS.indexOf(effort);
  return [...allowed].sort(
    (a, b) => Math.abs(ALL_EFFORTS.indexOf(a) - idx) - Math.abs(ALL_EFFORTS.indexOf(b) - idx),
  )[0];
};

export function settingsControls(model: ModelInfo, blockedConfigUpdate: string[] = []): SettingsControls {
  const family = familyOf(model.id);
  const sp = new Set(model.supported_parameters ?? []);
  const r = model.reasoning;
  const hints: string[] = [];

  let efforts: Effort[] = [];
  if (r) {
    efforts = r.supported_efforts === null ? [...ALL_EFFORTS] : [...(r.supported_efforts ?? [])];
    // "none" is never selectable as an effort: use the off switch instead (and Claude rejects it).
    efforts = efforts.filter((e) => e !== "none");
  }
  const mandatory = !!r?.mandatory;
  const budget = !!r && (r.supports_max_tokens === true || (family === "claude" && efforts.length > 0));
  const gpt56 = isGpt56Plus(model.id);

  if (family === "gemini" && r) {
    hints.push("Effort maps to Google's thinking level (xhigh is treated as high). The token budget is only approximate.");
  }
  if (family === "claude" && r) {
    hints.push("Max tokens is always kept above the reasoning budget. “minimal” is sent as “low”.");
  }
  if (family === "grok" && r) hints.push("Grok reasons by effort level only.");
  if (r && !efforts.length && !budget) hints.push("This model reasons automatically; there is nothing to tune.");
  if (mandatory) hints.push("Reasoning can't be turned off on this model.");

  return {
    family,
    generic: GENERIC_PARAMS.filter((p) => sp.has(p)),
    verbosity: sp.has("verbosity") || gpt56,
    reasoning: {
      available: !!r,
      efforts,
      defaultEffort: r?.default_effort === "none" ? undefined : r?.default_effort,
      defaultEnabled: r?.default_enabled ?? false,
      canDisable: !!r && !mandatory,
      budget,
    },
    pro: gpt56,
    contextMode: gpt56,
    configUpdate: canUseConfigUpdate(model.id, blockedConfigUpdate),
    hints,
  };
}

export interface ResolvedReasoning {
  kind: ReasoningKind;
  param?: Record<string, unknown>;
}

/** Turn the user's reasoning settings into the `reasoning` request object (never both effort and max_tokens). */
export function resolveReasoning(settings: ModelSettings, model: ModelInfo): ResolvedReasoning {
  const r = model.reasoning;
  if (!r) return { kind: { kind: "default" } };
  const ctl = settingsControls(model);
  const s = settings.reasoning;
  const param: Record<string, unknown> = {};
  if (s.exclude) param.exclude = true;

  if (s.enabled === false && ctl.reasoning.canDisable) {
    return { kind: { kind: "off" }, param: { ...param, enabled: false } };
  }

  // budget wins only when the model supports it; effort and budget are never sent together
  if (s.budget !== undefined && ctl.reasoning.budget) {
    param.max_tokens = Math.max(1024, Math.round(s.budget));
    return { kind: { kind: "budget", budget: param.max_tokens as number }, param };
  }

  if (s.effort && s.effort !== "none" && ctl.reasoning.efforts.length) {
    let effort = nearest(s.effort, ctl.reasoning.efforts);
    if (ctl.family === "claude" && effort === "minimal") effort = "low";
    param.effort = effort;
    if (ctl.pro && s.mode === "pro") param.mode = "pro";
    if (ctl.contextMode && s.context && s.context !== "auto") param.context = s.context;
    return { kind: { kind: "effort", effort }, param };
  }

  if (s.enabled === true) param.enabled = true;
  if (ctl.pro && s.mode === "pro") param.mode = "pro";
  if (ctl.contextMode && s.context && s.context !== "auto") param.context = s.context;
  return { kind: { kind: "default" }, param: Object.keys(param).length ? param : undefined };
}

/** Request-body fragment for a model: only parameters the model supports are included. */
export function buildRequestParams(settings: ModelSettings, model: ModelInfo): Record<string, unknown> {
  const ctl = settingsControls(model);
  const out: Record<string, unknown> = {};
  for (const p of ctl.generic) {
    const v = settings[p];
    if (v !== undefined) out[p] = v;
  }
  if (ctl.verbosity && settings.verbosity) out.verbosity = settings.verbosity;

  const res = resolveReasoning(settings, model);
  if (res.param) out.reasoning = res.param;

  out.max_tokens = requestMaxTokens({
    claude: ctl.family === "claude",
    userMax: settings.max_tokens,
    reasoning: res.kind,
  });

  const p = settings.provider;
  if (p) {
    const provider: Record<string, unknown> = {};
    if (p.sort) provider.sort = p.sort;
    if (p.data_collection) provider.data_collection = p.data_collection;
    if (p.allow_fallbacks !== undefined) provider.allow_fallbacks = p.allow_fallbacks;
    if (Object.keys(provider).length) out.provider = provider;
  }
  if (settings.fallbackModels?.length) out.models = [model.id, ...settings.fallbackModels];
  return out;
}

export function defaultSettings(model?: ModelInfo): ModelSettings {
  const r = model?.reasoning;
  return {
    reasoning: {
      enabled: r?.default_enabled ? true : undefined,
    },
  };
}
