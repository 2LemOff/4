import { describe, expect, it } from "vitest";
import { parseAnswer } from "../src/answer";
import { buildGraph, layoutMap, lineage, type MapCard } from "../src/mapLayout";

const a1 = parseAnswer(JSON.stringify({
  groups: [{ id: "g1", title: "Optics", parent: null }, { id: "g2", title: "Scattering", parent: "g1" }],
  nodes: [
    { id: "n1", kind: "foundation", text: "Light is a wave.", group: "g1", from: [] },
    { id: "n2", kind: "foundation", text: "Small particles scatter short waves more.", group: "g2", from: [] },
    { id: "n3", kind: "step", text: "Blue scatters most.", from: ["n1", "n2"] },
    { id: "n4", kind: "conclusion", text: "Sky is blue.", title: "Blue sky", from: ["n3"] },
    { id: "n5", kind: "foundation", text: "Unrelated fact.", from: [] },
    { id: "n6", kind: "conclusion", text: "Unrelated end.", from: ["n5"] },
  ],
}), "K1")!;
const a2 = parseAnswer(JSON.stringify({
  nodes: [
    { id: "n1", kind: "foundation", text: "Air has nitrogen.", from: ["K1.n2"] },
    { id: "n2", kind: "conclusion", text: "Nitrogen scatters blue.", from: ["n1"] },
  ],
}), "K2")!;
const cards: MapCard[] = [
  { id: "c1", parentId: null, question: "Why is the sky blue?", answer: a1, status: "done", createdAt: 1 },
  { id: "c2", parentId: "c1", question: "What in air?", anchorNodeIds: ["K1.n3"], answer: a2, status: "done", createdAt: 2 },
];

describe("buildGraph", () => {
  const g = buildGraph(cards);
  it("links answer → asked node → question → new pyramid", () => {
    expect(g.edges).toContainEqual({ from: "K1.n3", to: "q:c2", style: "asked" });
    expect(g.edges).toContainEqual({ from: "q:c2", to: "K2.n1", style: "asked" });
    expect(g.edges).toContainEqual({ from: "K1.n2", to: "K2.n1", style: "builds" });
    expect(g.edges).toContainEqual({ from: "K1.n1", to: "K1.n3", style: "derived" });
  });
  it("hangs every top node of an answer under its question", () => {
    expect(g.edges.filter((e) => e.from === "q:c1").map((e) => e.to).sort()).toEqual(["K1.n1", "K1.n2", "K1.n5"]);
  });
  it("falls back to the parent's conclusions for whole-answer questions", () => {
    const g2 = buildGraph([cards[0], { ...cards[1], anchorNodeIds: [] }]);
    expect(g2.edges.filter((e) => e.to === "q:c2").map((e) => e.from).sort()).toEqual(["K1.n4", "K1.n6"]);
  });
  it("foundations mode keeps foundations, conclusions and what supports what", () => {
    const f = buildGraph(cards, "foundations");
    expect(f.items.every((i) => i.kind === "foundation" || i.kind === "conclusion")).toBe(true);
    expect(f.edges).toContainEqual({ from: "K1.n2", to: "K2.n2", style: "supports" });
    expect(f.edges).toContainEqual({ from: "K1.n1", to: "K1.n4", style: "supports" });
    expect(f.edges.some((e) => e.from === "K1.n5" && e.to === "K1.n4")).toBe(false);
  });
});

describe("layoutMap", () => {
  const L = layoutMap(cards, "all", [["K2.n2", "K1.n4"]]);
  const box = (i: { x: number; y: number; w: number; h: number }) => ({ l: i.x - i.w / 2, r: i.x + i.w / 2, t: i.y - i.h / 2, b: i.y + i.h / 2 });
  it("places every item without overlaps", () => {
    for (let i = 0; i < L.items.length; i++)
      for (let j = i + 1; j < L.items.length; j++) {
        const a = box(L.items[i]);
        const b = box(L.items[j]);
        const overlap = a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1;
        expect(overlap, `${L.items[i].id} vs ${L.items[j].id}`).toBe(false);
      }
  });
  it("puts foundations above what is derived from them", () => {
    const y = (id: string) => L.items.find((i) => i.id === id)!.y;
    expect(y("K1.n1")).toBeLessThan(y("K1.n3"));
    expect(y("K1.n3")).toBeLessThan(y("K1.n4"));
    expect(y("q:c1")).toBeLessThan(y("K1.n1"));
    expect(y("K1.n3")).toBeLessThan(y("q:c2"));
  });
  it("draws categories around their nodes, nested inside their parent", () => {
    const g1 = L.groups.find((g) => g.id === "K1.g1")!;
    const g2 = L.groups.find((g) => g.id === "K1.g2")!;
    const n2 = box(L.items.find((i) => i.id === "K1.n2")!);
    expect(n2.l).toBeGreaterThanOrEqual(g2.x - 1);
    expect(n2.r).toBeLessThanOrEqual(g2.x + g2.w + 1);
    expect(g2.x).toBeGreaterThanOrEqual(g1.x - 1);
    expect(g2.x + g2.w).toBeLessThanOrEqual(g1.x + g1.w + 1);
  });
  it("keeps items that aren't in a category out of its box", () => {
    const groupsOf = (id: string): string[] => {
      const it = L.items.find((i) => i.id === id)!;
      const out: string[] = [];
      let g = L.groups.find((x) => x.id === it.group);
      while (g) {
        out.push(g.id);
        g = L.groups.find((x) => x.id === g!.parent);
      }
      return out;
    };
    for (const it of L.items)
      for (const g of L.groups) {
        if (groupsOf(it.id).includes(g.id)) continue;
        const b = box(it);
        const overlap = b.l < g.x + g.w - 1 && g.x < b.r - 1 && b.t < g.y + g.h - 1 && g.y < b.b - 1;
        expect(overlap, `${it.id} overlaps ${g.id}`).toBe(false);
      }
  });
  it("adds similar links without changing the layout", () => {
    expect(L.edges.some((e) => e.style === "similar")).toBe(true);
    expect(L.width).toBeGreaterThan(0);
  });
  it("traces what a node rests on and supports", () => {
    const s = lineage(L.edges, "K1.n2");
    expect(s.has("K1.n3")).toBe(true);
    expect(s.has("K2.n1")).toBe(true);
    expect(s.has("K1.n5")).toBe(false);
  });
  it("handles a question still streaming with no answer", () => {
    const S = layoutMap([{ id: "c9", parentId: null, question: "Q?", status: "streaming", createdAt: 1 }]);
    expect(S.items).toHaveLength(1);
  });
});
