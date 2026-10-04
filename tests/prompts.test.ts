import { describe, expect, it } from "vitest";
import {
  ALL_ON, DEFAULT_SYNTHESIS, DEFAULT_SYSTEM_PROMPT, DIRECTIVE_1, DIRECTIVE_2, PRESET_PROMPTS,
  composeSynthesisPrompt, composeSystemPrompt, detectToggles, outlineToMarkdown, serializeTree, setToggle,
} from "../src/prompts";

describe("system prompt", () => {
  it("contains both directives verbatim", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Never provide long, unbroken walls of text. Break answers into distinct, logical premises.");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Speak in first principles. Assume the user will question the foundational logic of every claim you make.");
    expect(DIRECTIVE_1).toBe("Never provide long, unbroken walls of text. Break answers into distinct, logical premises.");
    expect(DIRECTIVE_2).toBe("Speak in first principles. Assume the user will question the foundational logic of every claim you make.");
  });
  it("detects toggles from hand-edited text", () => {
    expect(detectToggles(DEFAULT_SYSTEM_PROMPT)).toEqual(ALL_ON);
    expect(detectToggles("Just be nice.")).toEqual({ noWalls: false, firstPrinciples: false, premiseFormat: false, pushback: false });
  });
  it("turns a rule off and on again", () => {
    const off = setToggle(DEFAULT_SYSTEM_PROMPT, "firstPrinciples", false);
    expect(off).not.toContain(DIRECTIVE_2);
    expect(off).toContain(DIRECTIVE_1);
    expect(off).not.toMatch(/\n{3,}/);
    expect(detectToggles(setToggle(off, "firstPrinciples", true)).firstPrinciples).toBe(true);
  });
  it("composes with extra text", () => {
    expect(composeSystemPrompt(ALL_ON, "Be brief.")).toMatch(/Be brief\.$/);
    expect(composeSystemPrompt({ ...ALL_ON, pushback: false })).not.toMatch(/re-examine/);
  });
});

describe("synthesis prompt", () => {
  it("every preset has instructions", () => {
    for (const p of Object.values(PRESET_PROMPTS)) expect(p.length).toBeGreaterThan(40);
  });
  it("reflects the options", () => {
    const s = { ...DEFAULT_SYNTHESIS, options: { depth: 3 as const, length: "brief" as const, examples: false, openQuestions: false, language: "French" } };
    const t = composeSynthesisPrompt(s, []);
    expect(t).toContain("at most 3 levels");
    expect(t).toContain("Length: brief");
    expect(t).toContain("Leave examples out");
    expect(t).toContain("Do not list open questions");
    expect(t).toContain("Write in French");
  });
  it("lists existing categories only in reuse mode", () => {
    expect(composeSynthesisPrompt(DEFAULT_SYNTHESIS, ["Economics", "Biology"])).toContain("Economics, Biology");
    expect(composeSynthesisPrompt({ ...DEFAULT_SYNTHESIS, categoryMode: "free" }, ["Finance"])).not.toContain("Finance");
  });
  it("uses a custom prompt as written", () => {
    expect(composeSynthesisPrompt({ ...DEFAULT_SYNTHESIS, prompt: "Make a haiku." }, [])).toMatch(/^Make a haiku\./);
  });
});

describe("serializeTree / outline markdown", () => {
  it("indents children and carries ids and anchors", () => {
    const t = serializeTree([
      { id: "r", parentId: null, question: "Q1", assistantText: "A1\nline" },
      { id: "c", parentId: "r", question: "Q2", anchor: { text: "A1" }, assistantText: "A2" },
    ]);
    expect(t).toBe(["[r] Q: Q1", "  A: A1 line", "  [c] On “A1” — Q: Q2", "    A: A2"].join("\n"));
  });
  it("renders markdown", () => {
    expect(outlineToMarkdown("T", "S", [{ heading: "H", points: [{ text: "p", cardIds: [] }] }])).toBe("# T\n\nS\n\n## H\n- p\n");
  });
});
