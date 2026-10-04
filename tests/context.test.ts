import { describe, expect, it } from "vitest";
import { branchTokens, estimateTokens, formatTokens, makeFreshCard, meter, shouldOfferFresh } from "../src/context";
import { indexCards, pathToRoot } from "../src/tree";
import { card } from "./fixtures";

describe("formatTokens", () => {
  it("abbreviates", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(38_400)).toBe("38k");
    expect(formatTokens(1_000_000)).toBe("1M");
    expect(formatTokens(1_048_576)).toBe("1M");
    expect(formatTokens(2_500_000)).toBe("2.5M");
  });
});

describe("meter", () => {
  const r = card({ id: "r", usage: { prompt: 1000, completion: 500, reasoning: 0 } });
  const c = card({ id: "c", parentId: "r", usage: { prompt: 5000, completion: 1000, reasoning: 200 } });
  const idx = indexCards([r, c]);
  it("uses the deepest card's exact usage plus the live draft estimate", () => {
    expect(branchTokens(idx, "c")).toBe(6000);
    expect(branchTokens(idx, "c", "x".repeat(40))).toBe(6010);
    expect(branchTokens(idx, "r")).toBe(1500);
  });
  it("formats the label and flips to warn at 70%", () => {
    expect(meter(38_000, 1_000_000).label).toBe("38k / 1M");
    expect(shouldOfferFresh(meter(699_999, 1_000_000))).toBe(false);
    expect(shouldOfferFresh(meter(700_000, 1_000_000))).toBe(true);
  });
  it("handles an unknown limit", () => expect(meter(10, 0).ratio).toBe(0));
  it("estimates about four characters per token", () => expect(estimateTokens("abcdefgh")).toBe(2));
});

describe("makeFreshCard", () => {
  it("creates a linked root whose answer is the summary", () => {
    const from = card({ id: "a", parentId: "r", anchor: { text: "Key claim", blockIdx: 0, sentenceIdx: 0 } });
    const fresh = makeFreshCard(from, "Summary text.\n\nSecond.", "n1", 99);
    expect(fresh.parentId).toBeNull();
    expect(fresh.portalFrom).toBe("a");
    expect(fresh.question).toBe("Continue from: Key claim");
    expect(fresh.blocks).toEqual(["Summary text.", "Second."]);
    expect(fresh.assistant?.content).toBe("Summary text.\n\nSecond.");
    expect(pathToRoot(indexCards([fresh]), "n1")).toHaveLength(1);
  });
});
