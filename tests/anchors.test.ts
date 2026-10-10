import { describe, expect, it } from "vitest";
import { findLoose, makeAnchor, plainWords, resolveAnchor, trimSpan } from "../src/anchors";

const TEXT = "Light scatters. Blue light scatters most.\nRed light scatters least, so sunsets look red.";

describe("text anchors", () => {
  it("trims whitespace from the ends of a selection", () => {
    expect(trimSpan("  ab c  ", 0, 8)).toEqual([2, 6]);
    expect(trimSpan("abc", 5, 9)).toEqual([3, 3]);
  });

  it("keeps the quote, its position and a little context", () => {
    const start = TEXT.indexOf("Blue");
    const a = makeAnchor(TEXT, start - 1, start + "Blue light".length + 1)!;
    expect(a.quote).toBe("Blue light");
    expect(a.start).toBe(start);
    expect(a.prefix.endsWith("Light scatters. ")).toBe(true);
    expect(a.suffix.startsWith(" scatters most.")).toBe(true);
    expect(makeAnchor(TEXT, 3, 3)).toBeUndefined();
    expect(makeAnchor("a   b", 1, 4)).toBeUndefined();
    // reversed ends are fine
    expect(makeAnchor(TEXT, start + 4, start)?.quote).toBe("Blue");
  });

  it("finds an anchor at its stored place, or by its context when the text moved", () => {
    const start = TEXT.indexOf("light scatters least");
    const a = makeAnchor(TEXT, start, start + "light scatters".length)!;
    expect(resolveAnchor(TEXT, a)).toEqual({ start, end: start + "light scatters".length });
    // two characters were added in front: the same occurrence is found through its context, not the first one
    const moved = "> " + TEXT;
    expect(resolveAnchor(moved, a)).toEqual({ start: start + 2, end: start + 2 + "light scatters".length });
    expect(resolveAnchor("nothing here", a)).toBeUndefined();
  });

  it("finds a search hit written in markdown inside the rendered text", () => {
    const rendered = "Intro.\nPremise two depends on it. It has a second sentence.";
    const at = findLoose(rendered, "**Premise two** depends\n on it.")!;
    expect(rendered.slice(at.start, at.end)).toBe("Premise two depends on it.");
    expect(findLoose(rendered, "- missing words")).toBeUndefined();
    expect(plainWords("## Title\n- [link](http://x) and `code`")).toBe("Title link and code");
  });
});
