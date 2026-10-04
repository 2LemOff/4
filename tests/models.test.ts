import { describe, expect, it } from "vitest";
import { defaultEmbeddingModel, familyModels, newestOf, priceLabel, roleDefaults } from "../src/models";
import type { ModelInfo } from "../src/types";

const m = (id: string, created: number, extra: Partial<ModelInfo> = {}): ModelInfo => ({ id, created, ...extra });
const list: ModelInfo[] = [
  m("google/gemini-3.1-pro-preview", 100),
  m("google/gemini-3.5-pro", 300),
  m("google/gemini-3.5-pro-image", 400),
  m("google/gemini-3.6-flash", 350),
  m("google/gemini-3.5-flash-lite", 360),
  m("x-ai/grok-4.5", 200),
  m("x-ai/grok-code-fast-1", 500),
  m("openai/gpt-5.6-sol", 250),
  m("openai/gpt-5.6-terra", 251),
  m("openai/gpt-5.6-mini", 252),
  m("anthropic/claude-sonnet-5.5", 260),
  m("anthropic/claude-sonnet-5", 150),
  m("anthropic/claude-opus-5.5", 270),
  m("anthropic/claude-fable-5.1", 280),
];

describe("models", () => {
  it("picks the newest per family and skips image / lite / code / mini variants", () => {
    expect(newestOf(list, "gemini-pro")?.id).toBe("google/gemini-3.5-pro");
    expect(newestOf(list, "gemini-flash")?.id).toBe("google/gemini-3.6-flash");
    expect(newestOf(list, "grok")?.id).toBe("x-ai/grok-4.5");
    expect(newestOf(list, "claude-sonnet")?.id).toBe("anthropic/claude-sonnet-5.5");
    expect(newestOf(list, "claude-opus")?.id).toBe("anthropic/claude-opus-5.5");
    expect(newestOf(list, "claude-fable")?.id).toBe("anthropic/claude-fable-5.1");
  });
  it("lists ChatGPT tiers newest first", () => {
    expect(familyModels(list, "openai").map((x) => x.id)).toEqual(["openai/gpt-5.6-terra", "openai/gpt-5.6-sol"]);
  });
  it("assigns role defaults", () => {
    expect(roleDefaults(list)).toEqual({ answer: "google/gemini-3.5-pro", tags: "google/gemini-3.6-flash", rerank: "anthropic/claude-sonnet-5.5" });
  });
  it("falls back to any model when a family is missing", () => {
    const d = roleDefaults([m("meta/x", 5)]);
    expect(d.answer).toBe("meta/x");
  });
  it("skips models that do not output text", () => {
    expect(familyModels([m("google/gemini-3-pro", 9, { architecture: { output_modalities: ["image"] } })], "gemini-pro")).toEqual([]);
  });
  it("prefers a known embedding model", () => {
    expect(defaultEmbeddingModel([m("a/embed", 9), m("openai/text-embedding-3-small", 1)])).toBe("openai/text-embedding-3-small");
  });
  it("formats prices per million", () => {
    expect(priceLabel(m("x", 1, { pricing: { prompt: "0.000002", completion: "0.00001" } }))).toBe("$2.00 / $10.00 per 1M");
  });
});
