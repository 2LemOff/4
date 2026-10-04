import { describe, expect, it } from "vitest";
import { anthropicBudget, canUseConfigUpdate, isGpt56Plus, reasoningExhausted, requestMaxTokens } from "../src/reasoning";

describe("anthropicBudget", () => {
  it("applies the documented ratios", () => {
    expect(anthropicBudget("high", 10000)).toBe(8000);
    expect(anthropicBudget("medium", 10000)).toBe(5000);
    expect(anthropicBudget("low", 10000)).toBe(2000);
    expect(anthropicBudget("minimal", 10000)).toBe(1024); // floor
    expect(anthropicBudget("xhigh", 10000)).toBe(9500);
    expect(anthropicBudget("max", 10000)).toBe(9500);
  });
  it("caps at 128000", () => {
    expect(anthropicBudget("max", 200000)).toBe(128000);
  });
});

describe("requestMaxTokens", () => {
  it("is strictly above an explicit budget", () => {
    const m = requestMaxTokens({ claude: true, reasoning: { kind: "budget", budget: 20000 } });
    expect(m).toBeGreaterThan(20000);
    expect(m - 20000).toBeGreaterThanOrEqual(4096);
  });
  it("leaves room for the answer on Claude effort levels", () => {
    for (const effort of ["max", "xhigh", "high", "medium", "low", "minimal"] as const) {
      const m = requestMaxTokens({ claude: true, reasoning: { kind: "effort", effort } });
      expect(m - anthropicBudget(effort, m)).toBeGreaterThanOrEqual(4096);
    }
  });
  it("respects a larger user max", () => {
    expect(requestMaxTokens({ claude: false, userMax: 50000, reasoning: { kind: "default" } })).toBe(50000);
  });
  it("does not inflate non-Claude effort requests", () => {
    expect(requestMaxTokens({ claude: false, reasoning: { kind: "effort", effort: "xhigh" } })).toBe(16000);
  });
});

describe("reasoningExhausted", () => {
  it("matches the documented example (302 completion, 301 reasoning)", () => {
    expect(reasoningExhausted({ completion_tokens: 302, reasoning_tokens: 301 }, "length")).toBe(true);
  });
  it("is false when visible output exists or the stop was normal", () => {
    expect(reasoningExhausted({ completion_tokens: 900, reasoning_tokens: 300 }, "length")).toBe(false);
    expect(reasoningExhausted({ completion_tokens: 302, reasoning_tokens: 301 }, "stop")).toBe(false);
    expect(reasoningExhausted(undefined, "length")).toBe(false);
  });
});

describe("model id rules", () => {
  it("detects GPT-5.6+", () => {
    expect(isGpt56Plus("openai/gpt-5.6-sol")).toBe(true);
    expect(isGpt56Plus("openai/gpt-6-astra")).toBe(true);
    expect(isGpt56Plus("openai/gpt-5.5")).toBe(false);
    expect(isGpt56Plus("openai/gpt-5")).toBe(false);
    expect(isGpt56Plus("anthropic/claude-opus-5")).toBe(false);
  });
  it("knows which models accept mid-conversation effort", () => {
    expect(canUseConfigUpdate("anthropic/claude-fable-5.1")).toBe(true);
    expect(canUseConfigUpdate("anthropic/claude-opus-5")).toBe(true);
    expect(canUseConfigUpdate("anthropic/claude-opus-5.5")).toBe(true);
    expect(canUseConfigUpdate("anthropic/claude-opus-4.8")).toBe(false);
    expect(canUseConfigUpdate("anthropic/claude-sonnet-5.5")).toBe(false);
    expect(canUseConfigUpdate("openai/gpt-6-astra")).toBe(true);
    expect(canUseConfigUpdate("openai/gpt-5.6-sol")).toBe(false);
    expect(canUseConfigUpdate("google/gemini-3.5-pro")).toBe(false);
  });
  it("honours the remembered-400 list", () => {
    expect(canUseConfigUpdate("anthropic/claude-opus-5", ["anthropic/claude-opus-5"])).toBe(false);
  });
});

import { reasoningParts } from "../src/reasoning";
describe("reasoningParts", () => {
  it("prefers detail text and summaries, counting encrypted blocks", () => {
    const r = reasoningParts({
      reasoning: "fallback",
      reasoning_details: [
        { type: "reasoning.summary", summary: "Short summary" },
        { type: "reasoning.text", text: "Full thoughts" },
        { type: "reasoning.encrypted" },
      ],
    });
    expect(r).toEqual({ text: "Short summary\n\nFull thoughts", encrypted: 1 });
  });
  it("falls back to the plain reasoning string", () => {
    expect(reasoningParts({ reasoning: "plain" })).toEqual({ text: "plain", encrypted: 0 });
    expect(reasoningParts(undefined)).toEqual({ text: "", encrypted: 0 });
  });
});
