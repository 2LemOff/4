import { describe, expect, it } from "vitest";
import { DEFAULT_STORY, drawPrompt, normalizeStory, sanitizeSvg, storyPrompt, svgDataUri } from "../src/storyStyles";

describe("story prompts", () => {
  it("TED-Ed and ScienceClic styles give different rules", () => {
    const ted = storyPrompt({ ...DEFAULT_STORY, style: "ted-ed" });
    const sci = storyPrompt({ ...DEFAULT_STORY, style: "scienceclic" });
    expect(ted).toContain("relatable character");
    expect(ted).toContain("exactly 4 scenes");
    expect(sci).toContain("ScienceClic");
    expect(sci).toContain("dark background");
    expect(sci).not.toContain("relatable character");
  });
  it("uses edited rules and screenshot notes", () => {
    const p = storyPrompt({ ...DEFAULT_STORY, style: "custom", rules: { custom: "Tell it as a detective story." }, notes: { custom: "pastel watercolor, round shapes" }, slides: 3 });
    expect(p).toContain("Tell it as a detective story.");
    expect(p).toContain("pastel watercolor");
    expect(p).toContain("exactly 3 scenes");
  });
  it("drawing prompt carries the chosen look", () => {
    expect(drawPrompt({ ...DEFAULT_STORY, look: "chalk" })).toContain("chalkboard");
    expect(drawPrompt({ ...DEFAULT_STORY, look: "custom", customLook: "neon outlines" })).toContain("neon outlines");
  });
});

describe("normalizeStory", () => {
  it("keeps slides with narration, up to the count", () => {
    const s = normalizeStory({ title: "T", slides: [{ heading: "a", narration: "n1", visual: "v" }, { heading: "b", narration: "" }, { narration: "n3" }, { narration: "n4" }] }, 2);
    expect(s.slides.map((x) => x.narration)).toEqual(["n1", "n3"]);
    expect(() => normalizeStory({ slides: [] }, 4)).toThrow();
  });
});

describe("sanitizeSvg", () => {
  it("strips scripts, handlers, foreignObject, images and external links", () => {
    const dirty = `Here you go:\n<svg viewBox="0 0 10 10" onload="alert(1)"><script>alert(2)</script><foreignObject><div>x</div></foreignObject><image href="http://evil/x.png"/><a href="https://evil"><rect width="5" height="5" onclick='steal()' fill="url(http://evil/p)"/></a><use href="#ok"/><style>@import url(http://evil.css);</style></svg> done`;
    const clean = sanitizeSvg(dirty)!;
    expect(clean.startsWith("<svg")).toBe(true);
    expect(clean).not.toMatch(/script|onload|onclick|foreignObject|<image|evil/i);
    expect(clean).toContain('href="#ok"');
    expect(clean).toContain('xmlns="http://www.w3.org/2000/svg"');
  });
  it("rejects missing or oversized SVG", () => {
    expect(sanitizeSvg("no svg here")).toBeUndefined();
    expect(sanitizeSvg(`<svg>${"x".repeat(13000)}</svg>`)).toBeUndefined();
  });
  it("makes a data URI", () => expect(svgDataUri("<svg/>")).toBe("data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E"));
});
