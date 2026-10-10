import { describe, expect, it } from "vitest";
import { branchLabel, circled, indexCards, lineBranches, linePath, lineRoot, parentLine, startsBranch } from "../src/tree";
import { bubblePreset, clampRect, keepInView, splitHeight } from "../src/panes";
import { card } from "./fixtures";

const hl = (ids: string[], quotes: string[]) => ({ text: quotes.join(" / "), quotes, scope: "highlights" as const, highlightIds: ids });
// main: r → m2 → m3; branch b1 from words in r (follow-up b1f), b2 from words in m2; b1x inside b1's answer
const r = card({ id: "r", createdAt: 1 });
const m2 = card({ id: "m2", parentId: "r", createdAt: 2 });
const b1 = card({ id: "b1", parentId: "r", createdAt: 3, anchor: hl(["h1"], ["short waves"]) });
const m3 = card({ id: "m3", parentId: "m2", createdAt: 4 });
const b1f = card({ id: "b1f", parentId: "b1", createdAt: 5 });
const b2 = card({ id: "b2", parentId: "m2", createdAt: 6, anchor: hl(["h2"], ["violet"]) });
const b1x = card({ id: "b1x", parentId: "b1f", createdAt: 7, anchor: hl(["h3"], ["Ebbinghaus"]) });
const b1again = card({ id: "b1again", parentId: "r", createdAt: 8, anchor: hl(["h1"], ["short waves"]) });
const idx = indexCards([r, m2, b1, m3, b1f, b2, b1x, b1again]);

describe("lines: the main chat and branches from highlighted words", () => {
  it("knows which line a card is on", () => {
    expect(startsBranch(b1)).toBe(true);
    expect(startsBranch(m2)).toBe(false);
    expect(lineRoot(idx, "m3")).toBe("r");
    expect(lineRoot(idx, "b1f")).toBe("b1");
    expect(lineRoot(idx, "b1x")).toBe("b1x");
  });

  it("follows questions asked without highlights, never into a branch", () => {
    expect(linePath(idx, "r").map((c) => c.id)).toEqual(["r", "m2", "m3"]);
    expect(linePath(idx, "b1").map((c) => c.id)).toEqual(["b1", "b1f"]);
  });

  it("numbers a line's branches oldest first; a new branch from the same words is the next number", () => {
    expect(lineBranches(idx, linePath(idx, "r")).map((c) => c.id)).toEqual(["b1", "b2", "b1again"]);
    expect(branchLabel(idx, "b1")).toBe("1");
    expect(branchLabel(idx, "b1again")).toBe("3");
    expect(branchLabel(idx, "b1x")).toBe("1.1");
    expect(branchLabel(idx, "r")).toBe("");
    expect(circled(2)).toBe("②");
  });

  it("finds the line a branch came from", () => {
    expect(parentLine(idx, "b1")).toBe("r");
    expect(parentLine(idx, "b1x")).toBe("b1");
    expect(parentLine(idx, "r")).toBeUndefined();
  });
});

describe("pane geometry", () => {
  it("ends the split just under the paragraph asked about, so it doesn't move", () => {
    expect(splitHeight({ paneHeight: 800, blockBottom: 300 })).toEqual({ height: 310, scrollBy: 0 });
    // too high: at least 30% for the original
    expect(splitHeight({ paneHeight: 800, blockBottom: 50 })).toEqual({ height: 240, scrollBy: 0 });
    // too low: the original scrolls up just enough
    expect(splitHeight({ paneHeight: 800, blockBottom: 700 })).toEqual({ height: 528, scrollBy: 182 });
  });

  it("keeps words visible when the keyboard shortens a pane", () => {
    expect(keepInView({ top: 100, bottom: 140, paneHeight: 400 })).toBe(0);
    expect(keepInView({ top: 380, bottom: 420, paneHeight: 400 })).toBe(32);
    // a tall paragraph keeps its top in view
    expect(keepInView({ top: 50, bottom: 900, paneHeight: 400 })).toBe(38);
    expect(keepInView({ top: -30, bottom: 10, paneHeight: 400 })).toBe(-42);
  });

  it("keeps the bubble on screen, shrinking it if the screen got smaller", () => {
    expect(clampRect({ x: 300, y: 700, w: 200, h: 200 }, { w: 412, h: 800 })).toEqual({ x: 212, y: 600, w: 200, h: 200 });
    expect(clampRect({ x: 10, y: 10, w: 400, h: 600 }, { w: 412, h: 400 })).toEqual({ x: 10, y: 0, w: 400, h: 400 });
    expect(clampRect({ x: -50, y: -5, w: 100, h: 50 }, { w: 412, h: 800 })).toEqual({ x: 0, y: 0, w: 200, h: 150 });
    const m = bubblePreset("M", { w: 400, h: 800 }, "top");
    expect(m).toEqual({ x: 28, y: 8, w: 344, h: 360 });
  });
});
