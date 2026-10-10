import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vitest";
import { fallbackArrangement, itemsIn, normalizeArrangement, OTHER } from "../src/arrange";
import { barScale, normalizeDiagram, suggestViews, uncovered } from "../src/diagrams";
import { numbered, plainLines, splitSources } from "../src/split";

const MD = `Light from the Sun contains **all colours**. On its way down, it hits [air molecules](https://x.y) that are much smaller than its wavelength.

## Why blue wins
- Short waves (blue, violet) are scattered about *5×* more than red ones (Rayleigh scattering).
- Our eyes are more sensitive to blue than to violet, e.g. some violet is absorbed high up.

| Colour | Wavelength | Scattering |
|---|---|---|
| Blue | 450 nm | strong |
| Red | 700 nm | weak |

1. First, light enters the air.
2. Then it scatters.

> So the sky looks blue from the ground.

\`\`\`
code stays whole
\`\`\``;

const words = (t: string) => t.match(/[\p{L}\p{N}]+/gu) ?? [];
const rendered = (md: string) =>
  renderToStaticMarkup(createElement(Markdown, { remarkPlugins: [remarkGfm] }, md))
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'");

describe("splitting for views (never loses a word)", () => {
  it("every word the chat shows is in exactly one sentence, in order", () => {
    const ss = splitSources([{ key: "c1", text: MD }]);
    expect(words(ss.map((s) => s.text).join(" "))).toEqual(words(rendered(MD)));
    expect(ss.map((s) => s.id)).toEqual(ss.map((_, i) => `s${i + 1}`));
  });

  it("fuzzed markdown keeps every word too", () => {
    const parts = ["Alpha beta.", "## Head one", "- item **bold** x", "1. step one", "| a | b |\n|---|---|\n| c | d |", "> quoted line", "Plain *em* text, e.g. this one.", "`code` inline"];
    let seed = 7;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    for (let n = 0; n < 40; n++) {
      const md = Array.from({ length: 2 + Math.floor(rnd() * 6) }, () => parts[Math.floor(rnd() * parts.length)]).join("\n\n");
      const ss = splitSources([{ key: "k", text: md }]);
      expect(words(ss.map((s) => s.text).join(" "))).toEqual(words(rendered(md)));
    }
  });

  it("keeps headings as their own sentences and marks them", () => {
    const ss = splitSources([{ key: "c1", text: MD }]);
    expect(ss.find((s) => s.text === "Why blue wins")?.heading).toBe(true);
    expect(ss.some((s) => s.text === "Blue | 450 nm | strong")).toBe(true);
    expect(ss.find((s) => s.text.startsWith("Our eyes"))!.text).toContain("e.g. some violet");
    expect(numbered(ss.slice(0, 1))).toBe("[s1] Light from the Sun contains all colours.");
    expect(plainLines("## A #\ntext").map((l) => l.text)).toEqual(["A", "text"]);
  });

  it("highlights split as plain text, each with its source", () => {
    const ss = splitSources([{ key: "h1", text: "One. Two." }, { key: "h2", text: "Three" }]);
    expect(ss.map((s) => [s.id, s.source, s.text])).toEqual([["s1", "h1", "One."], ["s2", "h1", "Two."], ["s3", "h2", "Three"]]);
  });
});

describe("arrangement", () => {
  const ss = splitSources([{ key: "c", text: "A one. B two. C three. D four." }]);
  it("keeps the model's placement, drops unknown or repeated ids, and never loses a sentence", () => {
    const a = normalizeArrangement(
      {
        title: "Letters",
        levels: [{ name: "Alphabet", about: "Letters.", siblings: ["Numbers", ""] }],
        groups: [{ id: "g1", title: "Start", parent: null }, { id: "g2", title: "Loop", parent: "g2" }, { id: "g1", title: "dup", parent: null }],
        items: [
          { id: "s2", group: "g1", kind: "step", label: "B", from: ["s1", "s9", "s2"] },
          { id: "s1", group: "g1", kind: "foundation", label: "A", from: [] },
          { id: "s2", group: "g2", kind: "detail", label: "again", from: [] },
          { id: "s99", group: "g1", kind: "detail", label: "ghost", from: [] },
          { id: "s3", group: "nope", kind: "weird", label: "", from: [] },
        ],
      },
      ss,
    );
    expect(a.items.map((i) => i.id)).toEqual(["s1", "s2", "s3", "s4"]);
    expect(a.items.find((i) => i.id === "s2")).toMatchObject({ group: "g1", kind: "step", from: ["s1"] });
    expect(a.items.find((i) => i.id === "s3")).toMatchObject({ group: OTHER, kind: "detail", label: "C three." });
    expect(a.items.find((i) => i.id === "s4")!.group).toBe(OTHER);
    expect(a.groups.map((g) => [g.id, g.parent])).toEqual([["g1", null], ["g2", null], [OTHER, null]]);
    expect(a.levels[0].siblings).toEqual(["Numbers"]);
    expect(itemsIn(a, "g1").map((i) => i.id)).toEqual(["s1", "s2"]);
  });

  it("falls back to questions and headings without a model", () => {
    const two = splitSources([{ key: "c1", text: "## Part\nOne. Two." }, { key: "c2", text: "Three." }]);
    const a = fallbackArrangement(two, { c1: "First question", c2: "Second question" });
    expect(a.fallback).toBe(true);
    expect(a.groups.map((g) => g.title)).toEqual(["First question", "Part", "Second question"]);
    expect(a.groups[1].parent).toBe(a.groups[0].id);
    expect(a.items.map((i) => i.group)).toEqual([a.groups[1].id, a.groups[1].id, a.groups[1].id, a.groups[2].id]);
  });
});

describe("diagrams", () => {
  const ss = splitSources([{ key: "c", text: "Blue light is 450 nm. Red light is 700 nm. Air scatters blue more." }]);
  it("keep only valid sources and drop broken elements", () => {
    const d = normalizeDiagram(
      "concept",
      { nodes: [{ id: "a", label: "Blue", sources: ["s1", "zz"] }, { id: "b", label: "Red", sources: ["s2"] }, { id: "", label: "x", sources: [] }], edges: [{ from: "a", to: "b", label: "vs", sources: ["s3"] }, { from: "a", to: "q", label: "x", sources: [] }] },
      ss,
    );
    expect(d.nodes).toEqual([{ id: "a", label: "Blue", sources: ["s1"] }, { id: "b", label: "Red", sources: ["s2"] }]);
    expect(d.edges).toHaveLength(1);
    expect(uncovered(d, ss)).toEqual([]);
  });
  it("list the sentences a diagram leaves out", () => {
    const d = normalizeDiagram("flow", { steps: [{ label: "Light enters", detail: "", sources: ["s1"] }] }, ss);
    expect(uncovered(d, ss).map((s) => s.id)).toEqual(["s2", "s3"]);
  });
  it("sort a scale ladder smallest first and read numbers", () => {
    const d = normalizeDiagram("scale", { items: [{ label: "Red", value: "700", unit: "nm", sources: ["s2"] }, { label: "Blue", value: 450, unit: "nm", sources: ["s1"] }, { label: "x", value: "n/a", unit: "", sources: [] }] }, ss);
    expect(d.items.map((i) => i.label)).toEqual(["Blue", "Red"]);
  });
  it("switch bars to a log scale when values differ more than 100×", () => {
    expect(barScale([1, 10, 50]).log).toBe(false);
    const s = barScale([1e-9, 1, 1e6]);
    expect(s.log).toBe(true);
    expect(s.at(1e6)).toBeCloseTo(1);
    expect(s.at(1e-9)).toBeGreaterThan(0);
  });
  it("suggest the best fitting views first", () => {
    expect(suggestViews(ss).slice(0, 2)).toEqual(["scale", "chart"]);
    const dated = splitSources([{ key: "c", text: "In 1905 Einstein wrote it. In 1915 came general relativity." }]);
    expect(suggestViews(dated)[0]).toBe("timeline");
    expect(suggestViews(splitSources([{ key: "h", text: "x" }]), { highlights: 2 }).slice(0, 2)).toEqual(["compare", "venn"]);
    expect(suggestViews(splitSources([{ key: "h", text: "plain words" }]))[0]).toBe("bigidea");
  });
});
