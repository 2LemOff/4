import { describe, expect, it } from "vitest";
import { defaultEmbeddingModel, familyModels, isNewModel, newestOf, popularModels, priceLabel, roleDefaults, updateFirstSeen } from "../src/models";
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
  it("never picks a :batch, :free or other variant as a default (the drawing model bug)", () => {
    const withVariants = [...list, m("anthropic/claude-sonnet-5.5:batch", 999), m("google/gemini-3.6-flash:free", 999), m("google/gemini-3.5-pro:nitro", 999)];
    expect(newestOf(withVariants, "claude-sonnet")?.id).toBe("anthropic/claude-sonnet-5.5");
    expect(newestOf(withVariants, "gemini-flash")?.id).toBe("google/gemini-3.6-flash");
    expect(roleDefaults(withVariants).answer).toBe("google/gemini-3.5-pro");
    expect(roleDefaults([m("meta/x:batch", 9), m("meta/x", 5)]).answer).toBe("meta/x");
  });
  it("skips models that do not output text", () => {
    expect(familyModels([m("google/gemini-3-pro", 9, { architecture: { output_modalities: ["image"] } })], "gemini-pro")).toEqual([]);
  });
  it("counts any top Gemini as Gemini, whatever its name (e.g. a code name like Argon)", () => {
    const withArgon = [...list, m("google/gemini-4-argon", 900), m("google/gemini-4-flash-lite", 950), m("google/gemma-4-27b", 990)];
    expect(newestOf(withArgon, "gemini-pro")?.id).toBe("google/gemini-4-argon");
    expect(roleDefaults(withArgon).answer).toBe("google/gemini-4-argon");
    expect(familyModels(withArgon, "gemini-pro").map((x) => x.id)).toEqual(["google/gemini-4-argon", "google/gemini-3.5-pro", "google/gemini-3.1-pro-preview"]);
  });
  it("lists popular models in OpenRouter's order (most used first), without variants or non-chat models", () => {
    const ranked = [m("b/second", 1, { rank: 1 }), m("a/first", 2, { rank: 0 }), m("c/x:free", 3, { rank: 2 }), m("d/tts-voice", 4, { rank: 3 }), m("e/fourth", 5, { rank: 4 })];
    expect(popularModels(ranked).map((x) => x.id)).toEqual(["a/first", "b/second", "e/fourth"]);
  });
  it("marks models that appeared since earlier refreshes as new for a week", () => {
    const first = updateFirstSeen(undefined, ["a", "b"], 1000);
    expect(first).toEqual({ a: 0, b: 0 });
    const later = updateFirstSeen(first, ["a", "b", "c"], 5000);
    expect(later.c).toBe(5000);
    expect(isNewModel("c", later, 6000)).toBe(true);
    expect(isNewModel("a", later, 6000)).toBe(false);
    expect(isNewModel("c", later, 5000 + 8 * 24 * 3600 * 1000)).toBe(false);
  });
  it("prefers a known embedding model", () => {
    expect(defaultEmbeddingModel([m("a/embed", 9), m("openai/text-embedding-3-small", 1)])).toBe("openai/text-embedding-3-small");
  });
  it("formats prices per million", () => {
    expect(priceLabel(m("x", 1, { pricing: { prompt: "0.000002", completion: "0.00001" } }))).toBe("$2.00 / $10.00 per 1M");
  });
});
