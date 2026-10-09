import { describe, expect, it } from "vitest";
import {
  answerTitle, nodesInGroup, outlineLines, outlineText, parseAnswer, pruneCrossLinks, pyramids, subsetOutline, textAnswer,
} from "../src/answer";

const json = JSON.stringify({
  groups: [
    { id: "g1", title: "Optics", parent: null },
    { id: "g2", title: "Scattering", parent: "g1" },
  ],
  nodes: [
    { id: "n1", kind: "foundation", text: "Light is a wave.", group: "g1", from: [], title: null },
    { id: "n2", kind: "foundation", text: "Small particles scatter short waves more.", group: "g2", from: ["K3.n4"], title: null },
    { id: "n3", kind: "step", text: "Blue light scatters most in air.", group: null, from: ["n1", "n2"], title: null },
    { id: "n4", kind: "conclusion", text: "So the sky looks blue.", group: null, from: ["n3"], title: "Why the sky is blue" },
    { id: "n5", kind: "foundation", text: "Sunsets pass through more air.", group: null, from: [], title: null },
    { id: "n6", kind: "conclusion", text: "So sunsets look red.", group: null, from: ["n5"], title: "Red sunsets" },
  ],
});

describe("parseAnswer", () => {
  const a = parseAnswer(json, "K7")!;
  it("namespaces ids and keeps cross-answer links", () => {
    expect(a.nodes.map((n) => n.id)).toEqual(["K7.n1", "K7.n2", "K7.n3", "K7.n4", "K7.n5", "K7.n6"]);
    expect(a.nodes[1].from).toEqual(["K3.n4"]);
    expect(a.nodes[2].from).toEqual(["K7.n1", "K7.n2"]);
    expect(a.groups.map((g) => [g.id, g.parent])).toEqual([["K7.g1", null], ["K7.g2", "K7.g1"]]);
    expect(a.nodes[0].group).toBe("K7.g1");
  });
  it("splits unrelated parts into separate pyramids", () => {
    const p = pyramids(a);
    expect(p).toHaveLength(2);
    expect(p.map((x) => x.title).sort()).toEqual(["Red sunsets", "Why the sky is blue"]);
  });
  it("names the answer from a conclusion title", () => expect(answerTitle(a)).toBe("Why the sky is blue"));
  it("parses a stream in progress", () => {
    const partial = json.slice(0, json.indexOf("Blue light") + 6);
    const p = parseAnswer(partial, "K7", { partial: true })!;
    expect(p.nodes.length).toBeGreaterThanOrEqual(2);
    expect(p.nodes[0].text).toBe("Light is a wave.");
  });
  it("accepts fenced JSON and drops broken references", () => {
    const a2 = parseAnswer('```json\n{"nodes":[{"id":"x","kind":"step","text":"A","from":["missing","x"]}]}\n```', "K1")!;
    expect(a2.nodes[0].from).toEqual([]);
    expect(a2.nodes[0].kind).toBe("step");
  });
  it("turns prose into a chain when the model ignored the format", () => {
    const t = parseAnswer("First idea.\n\nSecond idea.\n\nSo, third.", "K2")!;
    expect(t.converted).toBe(true);
    expect(t.nodes.map((n) => n.kind)).toEqual(["foundation", "step", "conclusion"]);
    expect(t.nodes[2].from).toEqual(["K2.p2"]);
    expect(parseAnswer("not done", "K2", { partial: true })).toBeUndefined();
  });
  it("breaks group cycles", () => {
    const c = parseAnswer(JSON.stringify({ groups: [{ id: "a", title: "A", parent: "b" }, { id: "b", title: "B", parent: "a" }], nodes: [{ id: "n", text: "t", group: "a" }] }), "K1")!;
    expect(c.groups.some((g) => g.parent === null)).toBe(true);
  });
  it("prunes cross links to unknown nodes", () => {
    expect(pruneCrossLinks(a, new Set()).nodes[1].from).toEqual([]);
    expect(pruneCrossLinks(a, new Set(["K3.n4"])).nodes[1].from).toEqual(["K3.n4"]);
  });
});

describe("outline", () => {
  const a = parseAnswer(json, "K7")!;
  it("nests categories and lists foundations, steps, conclusions", () => {
    const lines = outlineLines(a);
    expect(lines[0]).toMatchObject({ depth: 0, text: "Optics", groupId: "K7.g1" });
    expect(lines[1]).toMatchObject({ depth: 1, nodeId: "K7.n1" });
    expect(lines[2]).toMatchObject({ depth: 1, text: "Scattering" });
    expect(lines[3]).toMatchObject({ depth: 2, nodeId: "K7.n2" });
    expect(outlineText(a)).toContain("- Conclusion: So the sky looks blue.");
  });
  it("collects nodes of nested categories", () => expect(nodesInGroup(a, "K7.g1")).toEqual(["K7.n1", "K7.n2"]));
  it("outlines a subset with its categories", () => {
    const t = subsetOutline(a, ["K7.n2"]);
    expect(t).toContain("[Category] Optics");
    expect(t).toContain("Foundation: Small particles");
    expect(t).not.toContain("Light is a wave");
  });
  it("textAnswer handles a single paragraph", () => expect(textAnswer("Only.", "K1").nodes[0].kind).toBe("foundation"));
});
