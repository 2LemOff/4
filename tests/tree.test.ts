import { describe, expect, it } from "vitest";
import { breadcrumbs, buildMessages, children, drillCounts, indexCards, pathToRoot, siblings } from "../src/tree";
import type { ReasoningDetail } from "../src/types";
import { card } from "./fixtures";

const details: ReasoningDetail[] = [
  { type: "reasoning.text", text: "think", signature: "sig", format: "google-gemini-v1", index: 0 },
  { type: "reasoning.encrypted", data: "xyz", format: "google-gemini-v1", index: 1 },
];

const root = card({ id: "r", question: "What is X?", assistant: { content: "X is...", reasoning_details: details } });
const a = card({ id: "a", parentId: "r", question: "Why?", anchor: { text: "X is...", blockIdx: 0, sentenceIdx: 0 } });
const b = card({ id: "b", parentId: "r", question: "How?" });
const aa = card({ id: "aa", parentId: "a", question: "Really?", model: "openai/gpt-5.6-sol" });
const idx = indexCards([root, a, b, aa]);
const opts = { systemPrompt: "SYS", model: "google/gemini-3.5-pro" };

describe("tree navigation", () => {
  it("builds the path from root", () => expect(pathToRoot(idx, "aa").map((c) => c.id)).toEqual(["r", "a", "aa"]));
  it("lists children and siblings oldest first", () => {
    expect(children(idx, "r").map((c) => c.id)).toEqual(["a", "b"]);
    expect(siblings(idx, "b").map((c) => c.id)).toEqual(["a", "b"]);
    expect(siblings(idx, "r").map((c) => c.id)).toEqual(["r"]);
  });
  it("survives a parent cycle", () => {
    const x = card({ id: "x", parentId: "y" });
    const y = card({ id: "y", parentId: "x" });
    expect(pathToRoot(indexCards([x, y]), "x")).toHaveLength(2);
  });
  it("counts drilled sentences", () => {
    expect(drillCounts(idx, "r").get("0:0")).toBe(1);
  });
  it("makes breadcrumbs from tags, falling back to the text", () => {
    const i = indexCards([{ ...root, tag: "Physics" }, a]);
    expect(breadcrumbs(i, "a").map((c) => c.label)).toEqual(["Physics", "X is..."]);
  });
});

describe("buildMessages", () => {
  it("starts with the frozen system prompt and ends with the new question", () => {
    const m = buildMessages(idx, "r", "Why?", undefined, opts);
    expect(m[0]).toEqual({ role: "system", content: "SYS" });
    expect(m.at(-1)).toEqual({ role: "user", content: "Why?" });
  });
  it("is append-only: a child's prefix is exactly the parent's messages plus its answer", () => {
    const parent = buildMessages(idx, "r", "Why?", undefined, opts);
    const child = buildMessages(idx, "a", "Really?", undefined, opts);
    const prefix = child.slice(0, parent.length - 1);
    expect(prefix).toEqual(parent.slice(0, -1));
    // then the parent's own turn (with its quote) and answer, then the new question
    expect(child[parent.length - 1].content).toBe('About this statement from your previous answer: "X is..."\n\nMy question: Why?');
    expect(child[parent.length].role).toBe("assistant");
  });
  it("siblings share the same prefix", () => {
    const toA = buildMessages(idx, "r", "Q1", undefined, opts).slice(0, -1);
    const toB = buildMessages(idx, "r", "Q2", undefined, opts).slice(0, -1);
    expect(toA).toEqual(toB);
  });
  it("puts the quote only in the new turn", () => {
    const m = buildMessages(idx, "r", "Why?", { text: "X is...", blockIdx: 0, sentenceIdx: 0 }, opts);
    expect(m.at(-1)!.content).toBe('About this statement from your previous answer: "X is..."\n\nMy question: Why?');
    expect(m.slice(0, -1).some((x) => x.content.includes("About this statement"))).toBe(false);
  });
  it("replays reasoning_details unmodified for the same model", () => {
    const m = buildMessages(idx, "r", "Why?", undefined, opts);
    expect(m.find((x) => x.role === "assistant")!.reasoning_details).toBe(details);
  });
  it("drops reasoning for turns made by a different model", () => {
    const m = buildMessages(idx, "r", "Why?", undefined, { ...opts, model: "anthropic/claude-sonnet-5.5" });
    const asst = m.find((x) => x.role === "assistant")!;
    expect(asst.reasoning_details).toBeUndefined();
    expect(asst.content).toBe("X is...");
  });
  it("falls back to the plain reasoning string", () => {
    const i = indexCards([card({ id: "p", assistant: { content: "c", reasoning: "plain thoughts" } })]);
    const m = buildMessages(i, "p", "next", undefined, opts);
    expect(m.find((x) => x.role === "assistant")!.reasoning).toBe("plain thoughts");
  });
  it("keeps stored config updates in position only when the model accepts them, never adjacent", () => {
    const i = indexCards([card({ id: "c1", configUpdate: { effort: "low" } })]);
    const m = buildMessages(i, "c1", "next", undefined, { ...opts, includeConfigUpdates: true, newConfigUpdate: { effort: "high" } });
    const roles = m.map((x) => (x.configuration_update ? "cfg" : x.role));
    expect(roles).toEqual(["system", "cfg", "user", "assistant", "cfg", "user"]);
    for (let k = 1; k < roles.length; k++) expect(roles[k] === "cfg" && roles[k - 1] === "cfg").toBe(false);
    const off = buildMessages(i, "c1", "next", undefined, { ...opts, includeConfigUpdates: false, newConfigUpdate: { effort: "high" } });
    expect(off.some((x) => x.configuration_update)).toBe(false);
  });
  it("builds a first message for a new root", () => {
    expect(buildMessages(idx, null, "Hi", undefined, opts)).toEqual([
      { role: "system", content: "SYS" },
      { role: "user", content: "Hi" },
    ]);
  });
});
