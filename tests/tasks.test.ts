import { describe, expect, it } from "vitest";
import { defaultTaskModel, lengthOf, migrateTasks, TASK, TASKS, taskModelSettings, taskPrompt } from "../src/tasks";
import type { ModelInfo } from "../src/types";

const m = (id: string, created: number, extra: Partial<ModelInfo> = {}): ModelInfo => ({ id, created, ...extra });
const vision = { architecture: { input_modalities: ["text", "image"] } };
const MODELS: ModelInfo[] = [
  m("google/gemini-3.5-pro", 300, vision),
  m("google/gemini-3.6-flash", 350, vision),
  m("google/gemini-3.6-flash:free", 999, vision),
  m("anthropic/claude-sonnet-5.5", 260),
  m("anthropic/claude-sonnet-5.5:batch", 999),
  m("anthropic/claude-opus-5.5", 270),
];
const EMBED = [m("openai/text-embedding-3-small", 1)];

describe("tasks", () => {
  it("every task has a group, a label and a hint; ids are unique", () => {
    expect(new Set(TASKS.map((t) => t.id)).size).toBe(TASKS.length);
    for (const t of TASKS) expect(t.label && t.hint && t.group).toBeTruthy();
  });

  it("picks a sensible default model per task, never a :batch or :free variant", () => {
    const d = (id: keyof typeof TASK) => defaultTaskModel(TASK[id], MODELS, EMBED, "google/gemini-3.5-pro");
    expect(d("quick")).toBe("google/gemini-3.6-flash");
    expect(d("quickCheck")).toBe("anthropic/claude-sonnet-5.5");
    expect(d("sketch")).toBe("anthropic/claude-sonnet-5.5");
    expect(d("verifier")).toBe("google/gemini-3.6-flash");
    expect(d("chairman")).toBe("google/gemini-3.5-pro");
    expect(d("storyWriter")).toBe("google/gemini-3.5-pro");
    expect(d("embed")).toBe("openai/text-embedding-3-small");
    // vision tasks only consider models that read images
    expect(defaultTaskModel(TASK.ocr, [m("google/gemini-3.6-flash", 9), m("acme/eyes", 5, vision)], [], "x/y")).toBe("acme/eyes");
  });

  it("sends the edited prompt, then anything the caller adds, the length rule and the format the app needs", () => {
    expect(taskPrompt(TASK.summary)).toBe(`${TASK.summary.prompt}\n\nKeep it under 150 words.\n\nReply with plain text only.`);
    expect(taskPrompt(TASK.summary, { prompt: "Sum it up.", length: "w80" })).toBe("Sum it up.\n\nKeep it under 80 words.\n\nReply with plain text only.");
    expect(taskPrompt(TASK.sketch, undefined, "Look: chalk.")).toBe(`${TASK.sketch.prompt}\n\nLook: chalk.\n\n${TASK.sketch.fixed}`);
    expect(lengthOf(TASK.quick)?.id).toBe("s3");
    expect(lengthOf(TASK.quick, { length: "nope" })?.id).toBe("s3");
    expect(lengthOf(TASK.answer)).toBeUndefined();
  });

  it("settings: the user's own per model, else the model's defaults with the task's base; length sets max tokens", () => {
    const flash = MODELS[1];
    const base = taskModelSettings(TASK.quick, undefined, flash);
    expect(base.reasoning.effort).toBe("low");
    expect(base.max_tokens).toBe(1500);
    expect(taskModelSettings(TASK.quick, { length: "s1" }, flash).max_tokens).toBe(800);
    const own = taskModelSettings(TASK.quick, { settings: { [flash.id]: { reasoning: { effort: "high" }, max_tokens: 999 } } }, flash);
    expect(own).toEqual({ reasoning: { effort: "high" }, max_tokens: 999 });
    // settings saved for another model don't leak
    expect(taskModelSettings(TASK.quick, { settings: { other: { reasoning: {}, max_tokens: 5 } } }, flash).max_tokens).toBe(1500);
  });

  it("moves older model choices into tasks once", () => {
    const t = migrateTasks({
      roleModels: { answer: "a/answer", tags: "a/tags", rerank: "a/rerank", embed: "a/embed" },
      council: { chairman: "a/chair", verifier: "a/verify" },
      story: { storyModel: "a/story", drawModel: "a/draw" },
    });
    expect(t).toEqual({
      answer: { model: "a/answer" },
      summary: { model: "a/tags" },
      rerank: { model: "a/rerank" },
      embed: { model: "a/embed" },
      chairman: { model: "a/chair" },
      verifier: { model: "a/verify" },
      storyWriter: { model: "a/story" },
      sketch: { model: "a/draw" },
    });
    expect(migrateTasks({ tasks: { quick: { length: "s1" } }, roleModels: { answer: "ignored" } })).toEqual({ quick: { length: "s1" } });
    expect(migrateTasks({})).toEqual({});
  });
});
