import { describe, expect, it } from "vitest";
import { buildRequestParams, familyOf, resolveReasoning, settingsControls } from "../src/modelRules";
import type { ModelSettings } from "../src/types";
import { claude, claudeTemp, gemini, gpt, grok, plain } from "./fixtures";

const S = (r: ModelSettings["reasoning"] = {}, rest: Partial<ModelSettings> = {}): ModelSettings => ({ reasoning: r, ...rest });

describe("familyOf", () => {
  it("maps provider prefixes", () => {
    expect(familyOf("anthropic/claude-opus-5")).toBe("claude");
    expect(familyOf("~anthropic/claude-sonnet-latest")).toBe("claude");
    expect(familyOf("google/gemini-3.5-pro")).toBe("gemini");
    expect(familyOf("x-ai/grok-4.5")).toBe("grok");
    expect(familyOf("openai/gpt-5.6-sol")).toBe("openai");
    expect(familyOf("meta/llama")).toBe("other");
  });
});

describe("settingsControls", () => {
  it("shows only generic controls the model lists", () => {
    expect(settingsControls(claude).generic).toEqual([]);
    expect(settingsControls(claudeTemp).generic).toEqual(["temperature", "top_p"]);
    expect(settingsControls(gemini).generic).toEqual(["temperature", "top_p", "seed"]);
  });
  it("has no reasoning controls without a reasoning object", () => {
    const c = settingsControls(plain);
    expect(c.reasoning.available).toBe(false);
    expect(c.reasoning.efforts).toEqual([]);
  });
  it("filters efforts to supported_efforts, highest first, never offering none", () => {
    expect(settingsControls(gpt).reasoning.efforts).toEqual(["xhigh", "high", "medium", "low"]);
    expect(settingsControls(gemini).reasoning.efforts).toEqual(["high", "medium", "low", "minimal"]);
  });
  it("null supported_efforts means every gateway value except none", () => {
    const m = { ...grok, reasoning: { supported_efforts: null } };
    expect(settingsControls(m).reasoning.efforts).toEqual(["max", "xhigh", "high", "medium", "low", "minimal"]);
  });
  it("hides the off switch when reasoning is mandatory", () => {
    expect(settingsControls(gemini).reasoning.canDisable).toBe(false);
    expect(settingsControls(grok).reasoning.canDisable).toBe(true);
  });
  it("shows the budget slider when supported, and always for Claude", () => {
    expect(settingsControls(gemini).reasoning.budget).toBe(true);
    expect(settingsControls(grok).reasoning.budget).toBe(false);
    expect(settingsControls(claude).reasoning.budget).toBe(true);
  });
  it("offers GPT-5.6+ extras only on those models", () => {
    const g = settingsControls(gpt);
    expect(g.pro && g.contextMode && g.verbosity).toBe(true);
    expect(settingsControls(claude).pro).toBe(false);
    expect(settingsControls(grok).pro).toBe(false);
  });
  it("adds family hints", () => {
    expect(settingsControls(gemini).hints.join(" ")).toMatch(/thinking level/);
    expect(settingsControls(claude).hints.join(" ")).toMatch(/minimal/);
  });
});

describe("resolveReasoning / buildRequestParams", () => {
  it("never sends both effort and max_tokens", () => {
    const r = resolveReasoning(S({ effort: "high", budget: 5000 }), claude);
    const p = r.param as Record<string, unknown>;
    expect("effort" in p && "max_tokens" in p).toBe(false);
    expect(p.max_tokens).toBe(5000);
  });
  it("sends effort when no budget is set", () => {
    expect(resolveReasoning(S({ effort: "high" }), grok).param).toEqual({ effort: "high" });
  });
  it("ignores a budget on models without budget support", () => {
    expect(resolveReasoning(S({ effort: "low", budget: 3000 }), grok).param).toEqual({ effort: "low" });
  });
  it("sends Claude minimal as low", () => {
    expect(resolveReasoning(S({ effort: "minimal" }), claude).param).toEqual({ effort: "low" });
  });
  it("never sends effort none", () => {
    expect(resolveReasoning(S({ effort: "none" }), claude).param).toBeUndefined();
  });
  it("disables with enabled:false only where allowed", () => {
    expect(resolveReasoning(S({ enabled: false }), grok).param).toEqual({ enabled: false });
    const mandatory = resolveReasoning(S({ enabled: false, effort: "low" }), gemini);
    expect(mandatory.param).toEqual({ effort: "low" });
  });
  it("snaps an unsupported effort to the nearest supported level", () => {
    expect(resolveReasoning(S({ effort: "xhigh" }), gemini).param).toEqual({ effort: "high" });
    expect(resolveReasoning(S({ effort: "medium" }), grok).param).toBeDefined();
  });
  it("passes exclude through", () => {
    expect(resolveReasoning(S({ effort: "high", exclude: true }), grok).param).toEqual({ effort: "high", exclude: true });
  });
  it("sends no reasoning object for non-reasoning models", () => {
    expect(buildRequestParams(S({ effort: "high" }), plain).reasoning).toBeUndefined();
  });
  it("sends pro mode and reasoning context only on GPT-5.6+", () => {
    const p = resolveReasoning(S({ effort: "high", mode: "pro", context: "all_turns" }), gpt).param;
    expect(p).toEqual({ effort: "high", mode: "pro", context: "all_turns" });
    const other = resolveReasoning(S({ effort: "high", mode: "pro", context: "all_turns" }), grok).param;
    expect(other).toEqual({ effort: "high" });
  });
  it("does not send context auto", () => {
    expect(resolveReasoning(S({ effort: "high", context: "auto" }), gpt).param).toEqual({ effort: "high" });
  });
  it("only sends sampling params the model supports", () => {
    const body = buildRequestParams(S({}, { temperature: 0.4, top_p: 0.9, top_k: 20 }), claudeTemp);
    expect(body.temperature).toBe(0.4);
    expect(body.top_p).toBe(0.9);
    expect(body.top_k).toBeUndefined();
    expect(buildRequestParams(S({}, { temperature: 0.4 }), claude).temperature).toBeUndefined();
  });
  it("keeps max_tokens strictly above a reasoning budget", () => {
    const body = buildRequestParams(S({ budget: 30000 }, { max_tokens: 8000 }), claude);
    expect(body.max_tokens as number).toBeGreaterThan(30000);
  });
  it("sends provider routing and fallback models", () => {
    const body = buildRequestParams(S({}, { provider: { sort: "price", data_collection: "deny" }, fallbackModels: ["x/y"] }), grok);
    expect(body.provider).toEqual({ sort: "price", data_collection: "deny" });
    expect(body.models).toEqual(["x-ai/grok-4.5", "x/y"]);
  });
  it("sends verbosity only where supported", () => {
    expect(buildRequestParams(S({}, { verbosity: "low" }), gpt).verbosity).toBe("low");
    expect(buildRequestParams(S({}, { verbosity: "low" }), grok).verbosity).toBeUndefined();
  });
});
