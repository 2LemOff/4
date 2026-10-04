import { describe, expect, it } from "vitest";
import { splitBlocks, splitSentences } from "../src/blocks";

describe("splitBlocks", () => {
  it("splits on blank lines", () => {
    expect(splitBlocks("One.\n\nTwo.\n\n\nThree.")).toEqual(["One.", "Two.", "Three."]);
  });
  it("keeps fenced code whole, blank lines included", () => {
    const md = "Intro.\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\nOutro.";
    expect(splitBlocks(md)).toEqual(["Intro.", "```js\nconst a = 1;\n\nconst b = 2;\n```", "Outro."]);
  });
  it("keeps a list together", () => {
    expect(splitBlocks("Items:\n- a\n- b\n\nDone.")).toEqual(["Items:\n- a\n- b", "Done."]);
  });
  it("ignores empty input", () => {
    expect(splitBlocks("  \n\n ")).toEqual([]);
  });
});

describe("splitSentences", () => {
  it("splits plain prose", () => {
    expect(splitSentences("Water boils at 100 C. It depends on pressure! Why?")).toEqual([
      "Water boils at 100 C.",
      "It depends on pressure!",
      "Why?",
    ]);
  });
  it("returns lists and code whole", () => {
    expect(splitSentences("- a. b\n- c")).toHaveLength(1);
    expect(splitSentences("```\nx. y\n```")).toHaveLength(1);
  });
  it("does not split on a lowercase continuation such as e.g.", () => {
    const s = splitSentences("Use a unit, e.g. metres, for length. Then convert.");
    expect(s[0]).toContain("e.g. metres");
    expect(s).toHaveLength(2);
  });
});
