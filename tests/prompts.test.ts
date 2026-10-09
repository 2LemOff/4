import { describe, expect, it } from "vitest";
import {
  ALL_ON, DEFAULT_SYNTHESIS, DEFAULT_SYSTEM_PROMPT, PREMISES, PRESET_PROMPTS, migrateSystemPrompt,
  composeSynthesisPrompt, composeSystemPrompt, detectToggles, outlineToMarkdown, serializeTree, setToggle,
} from "../src/prompts";

describe("system prompt", () => {
  it("has exactly the two rules", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toBe(
      "Break answers into distinct, logical premises.\n\nWhen the query challenges something you said, re-examine it honestly: concede plainly if you were wrong, defend it with reasons if you were right, and say so when you are unsure.",
    );
    expect(PREMISES).toBe("Break answers into distinct, logical premises.");
  });
  it("detects toggles from hand-edited text", () => {
    expect(detectToggles(DEFAULT_SYSTEM_PROMPT)).toEqual(ALL_ON);
    expect(detectToggles("Just be nice.")).toEqual({ premises: false, pushback: false });
  });
  it("turns a rule off and on again", () => {
    const off = setToggle(DEFAULT_SYSTEM_PROMPT, "pushback", false);
    expect(off).toBe(PREMISES);
    expect(detectToggles(setToggle(off, "pushback", true)).pushback).toBe(true);
  });
  it("composes with extra text", () => {
    expect(composeSystemPrompt(ALL_ON, "Be brief.")).toMatch(/Be brief\.$/);
    expect(composeSystemPrompt({ ...ALL_ON, pushback: false })).not.toMatch(/re-examine/);
  });
  it("migrates older saved prompts to the two rules, keeping the user's own text", () => {
    const old = [
      "You are Fractal, a tutor for a learner who explores a subject by questioning every answer you give.",
      "Never provide long, unbroken walls of text. Break answers into distinct, logical premises.",
      "Speak in first principles. Assume the user will question the foundational logic of every claim you make.",
      "Keep each premise short and self-contained: one claim per premise, stated plainly, with no filler.",
      "When the learner challenges something you said, re-examine it honestly: concede plainly if you were wrong, defend it with reasons if you were right, and say so when you are unsure.",
    ].join("\n\n");
    expect(migrateSystemPrompt(old)).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(migrateSystemPrompt(`${old}\n\nAnswer in German.`)).toBe(`${DEFAULT_SYSTEM_PROMPT}\n\nAnswer in German.`);
    expect(migrateSystemPrompt("My own prompt.")).toBe("My own prompt.");
    expect(migrateSystemPrompt(DEFAULT_SYSTEM_PROMPT)).toBe(DEFAULT_SYSTEM_PROMPT);
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
