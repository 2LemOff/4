import { describe, expect, it } from "vitest";
import { aggregateRankings, applyGrounding, labelOf, parseRanking } from "../src/councilLogic";
import { parseAnswer } from "../src/answer";

describe("rankings", () => {
  it("parses Karpathy's FINAL RANKING section", () => {
    const t = "Response A is vague. Response C cites 1. Response B wrongly.\n\nFINAL RANKING:\n1. Response C\n2. Response A\n3. Response B";
    expect(parseRanking(t)).toEqual(["C", "A", "B"]);
    expect(parseRanking("no ranking here")).toEqual([]);
  });
  it("normalizes labels", () => {
    expect(labelOf("Response b")).toBe("B");
    expect(labelOf("C")).toBe("C");
  });
  it("averages positions per model, best first", () => {
    const agg = aggregateRankings([["C", "A", "B"], ["Response A", "Response C", "Response B"], ["C", "B", "A"]], { A: "m/a", B: "m/b", C: "m/c" });
    expect(agg.map((a) => [a.model, a.avgRank])).toEqual([["m/c", 1.33], ["m/a", 2], ["m/b", 2.67]]);
    expect(agg[0].votes).toBe(3);
  });
  it("ignores unknown labels", () => expect(aggregateRankings([["Z", "A"]], { A: "m/a" })).toEqual([{ label: "A", model: "m/a", avgRank: 2, votes: 1 }]));
});

describe("grounding", () => {
  const ans = parseAnswer(JSON.stringify({
    groups: [{ id: "g1", title: "G", parent: null }, { id: "g2", title: "Empty later", parent: null }],
    nodes: [
      { id: "n1", kind: "foundation", text: "From A", group: "g1", from: [], sources: ["A"] },
      { id: "n2", kind: "foundation", text: "No source", group: "g2", from: [], sources: [] },
      { id: "n3", kind: "step", text: "Made up", from: ["n1", "n2"], sources: ["Response B"] },
      { id: "n4", kind: "conclusion", text: "Wrong label", from: ["n3"], sources: ["Z"] },
    ],
  }), "K2")!;
  it("removes points without valid sources or rejected by the verifier, with their links and empty categories", () => {
    const r = applyGrounding(ans, ["A", "B"], [{ id: "K2.n3", supported: false }], true);
    expect(r.unsupported.sort()).toEqual(["K2.n2", "K2.n3", "K2.n4"]);
    expect(r.answer.nodes.map((n) => n.id)).toEqual(["K2.n1"]);
    expect(r.answer.groups.map((g) => g.id)).toEqual(["K2.g1"]);
  });
  it("can keep them flagged instead", () => {
    const r = applyGrounding(ans, ["A", "B"], [{ id: "K2.n1", supported: true }], false);
    expect(r.answer.nodes.map((n) => n.grounded)).toEqual([true, false, true, false]);
  });
});
