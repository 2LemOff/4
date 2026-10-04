import { describe, expect, it } from "vitest";
import { cosine, hitText, keywordSearch, topCards } from "../src/search";
import { card } from "./fixtures";

describe("vector search", () => {
  it("computes cosine similarity", () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
  it("returns the best block per card, best card first", () => {
    const rows = [
      { cardId: "a", blockIdx: -1, vector: [0, 1] },
      { cardId: "a", blockIdx: 2, vector: [1, 0.1] },
      { cardId: "b", blockIdx: 0, vector: [0.5, 0.5] },
      { cardId: "c", blockIdx: 0, vector: [-1, 0] },
    ];
    const hits = topCards([1, 0], rows, 2);
    expect(hits.map((h) => h.cardId)).toEqual(["a", "b"]);
    expect(hits[0].blockIdx).toBe(2);
  });
});

describe("keyword fallback", () => {
  const a = card({ id: "a", tag: "Observers", question: "Who counts as an observer?", blocks: ["An observer is any system that interacts."] });
  const b = card({ id: "b", question: "What is entropy?", blocks: ["Entropy measures disorder."] });
  it("finds cards by shared words, including prefixes", () => {
    const hits = keywordSearch([a, b], "where did I ask about observers?");
    expect(hits[0].cardId).toBe("a");
    expect(hits.some((h) => h.cardId === "b")).toBe(false);
  });
  it("returns nothing for an empty query", () => expect(keywordSearch([a], "  ")).toEqual([]));
  it("returns the matching block text", () => {
    const hit = keywordSearch([b], "disorder")[0];
    expect(hitText(b, hit.blockIdx)).toBe("Entropy measures disorder.");
  });
});
