import { describe, expect, it } from "vitest";
import { claimCounts, normalizeClaims, normalizeVerdict, quickMessages } from "../src/quick";
import type { ChatMessage } from "../src/tree";

const history: ChatMessage[] = [
  { role: "system", content: "SYS" },
  { role: "user", content: "Q1" },
  { role: "assistant", content: "A1" },
];

describe("quick answers", () => {
  it("reuse the branch history as is, then ask with the quick instructions and the quoted words", () => {
    const m = quickMessages(history, "Be brief.", ["the words"], [], "Why?");
    expect(m.slice(0, 3)).toEqual(history);
    expect(m[3]).toEqual({ role: "user", content: 'Be brief.\n\nAbout this part of your previous answer: "the words"\n\nMy question: Why?' });
    expect(m).toHaveLength(4);
  });
  it("carry earlier turns of the same thread; only the first turn quotes", () => {
    const m = quickMessages(history, "Be brief.", ["a", "b"], [{ question: "Explain", answer: "Short." }], "And then?");
    expect(m.slice(3).map((x) => x.role)).toEqual(["user", "assistant", "user"]);
    expect(m[3].content).toContain('1. "a"\n2. "b"');
    expect(m[4].content).toBe("Short.");
    expect(m[5].content).toBe("Be brief.\n\nAnd then?");
  });
  it("read a checker's verdict safely", () => {
    expect(normalizeVerdict({ verdict: "OK", reason: " fine " })).toEqual({ verdict: "ok", reason: "fine" });
    expect(normalizeVerdict({ verdict: "maybe" }).verdict).toBe("unsure");
    expect(normalizeVerdict(null)).toEqual({ verdict: "unsure", reason: "" });
  });
});

describe("claim checks", () => {
  it("keep real claims, read unknown verdicts as uncertain, and count them", () => {
    const claims = normalizeClaims({
      claims: [
        { claim: "Blue scatters most", quote: "blue", verdict: "supported", reason: "Rayleigh." },
        { claim: "Violet is absent", quote: "violet", verdict: "DISPUTED", reason: "It's present but absorbed." },
        { claim: "", verdict: "supported" },
        { claim: "Eyes vary", verdict: "probably" },
      ],
    });
    expect(claims.map((c) => c.verdict)).toEqual(["supported", "disputed", "uncertain"]);
    expect(claimCounts(claims)).toEqual({ supported: 1, uncertain: 1, disputed: 1 });
    expect(normalizeClaims({})).toEqual([]);
  });
});
