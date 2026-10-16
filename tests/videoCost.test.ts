import { describe, expect, it } from "vitest";
import { clock, costLabel, videoCost, videosCostLabel, videoTokensPerSecond } from "../src/videoCost";
import type { ModelInfo } from "../src/types";

const gemini4: ModelInfo = { id: "google/gemini-4-argon", architecture: { input_modalities: ["text", "image", "video"] }, pricing: { prompt: "0.000002" } };
const gemini25: ModelInfo = { id: "google/gemini-2.5-flash", architecture: { input_modalities: ["text", "image", "video"] }, pricing: { prompt: "0.0000003" } };
const claudeLike: ModelInfo = { id: "anthropic/claude-sonnet-5.5", architecture: { input_modalities: ["text", "image"] }, pricing: { prompt: "0.000003" } };
const textOnly: ModelInfo = { id: "x-ai/grok-4.5", architecture: { input_modalities: ["text"] }, pricing: { prompt: "0.000003" } };

describe("what a video costs", () => {
  it("counts Gemini video tokens per second (70 per frame + 32 for sound on Gemini 3+, 263 + 32 before)", () => {
    expect(videoTokensPerSecond("google/gemini-4-argon")).toBe(102);
    expect(videoTokensPerSecond("google/gemini-2.5-flash")).toBe(295);
    expect(videoTokensPerSecond("acme/vision-x")).toBe(300);
  });
  it("prices a clip from the model's prompt price", () => {
    // 30 s × 102 tokens × $2 per million
    expect(videoCost(gemini4, 30, 8, true)).toEqual({ tokens: 3060, usd: 3060 * 0.000002, as: "video" });
    expect(videoCost(gemini25, 30, 8, true).tokens).toBe(8850);
    expect(costLabel(videoCost(gemini4, 30, 8, true), 30)).toBe("≈ 3.1k tokens · ≈ $0.0061");
  });
  it("models that only see pictures are priced for the still frames", () => {
    const c = videoCost(claudeLike, 30, 8, true);
    expect(c).toMatchObject({ tokens: 6400, as: "frames" });
    expect(costLabel(c, 30)).toBe("as still frames, ≈ 6.4k tokens · ≈ $0.02");
    // a per-image price wins over tokens
    expect(videoCost({ ...claudeLike, pricing: { prompt: "0.000003", image: "0.001" } }, 30, 8, true).usd).toBeCloseTo(0.008);
  });
  it("says when it can't be seen or when the length isn't known (a link)", () => {
    expect(costLabel(videoCost(textOnly, 30, 8, false), 30)).toBe("this model can't see it");
    expect(costLabel(videoCost(gemini4, undefined, 0, true), undefined)).toBe("billed by its length (shown after the answer)");
    expect(videosCostLabel(gemini4, [{ seconds: 10, frames: 5 }, { seconds: 20, frames: 8 }], true)).toBe("≈ 3.1k tokens · ≈ $0.0061");
  });
  it("shows lengths as m:ss", () => {
    expect(clock(3.2)).toBe("0:03");
    expect(clock(125)).toBe("2:05");
    expect(clock(undefined)).toBe("");
  });
});
