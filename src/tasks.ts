/**
 * Every place the app uses a model is a task with its own settings: the model, the prompt, the length and every
 * parameter the model supports. This module is pure: the list of tasks, their defaults, and how saved choices
 * resolve. Store-bound helpers are in taskConfig.ts.
 */
import { defaultEmbeddingModel, newestOf, type PickerFamily } from "./models";
import { defaultSettings } from "./modelRules";
import type { ModelInfo, ModelSettings } from "./types";

export type TaskKind = "text" | "vision" | "embed";
export type TaskGroup = "Chat" | "Council" | "Views" | "Photos" | "Search and memory" | "Stories";

export type TaskId =
  | "answer"
  | "quick"
  | "quickCheck"
  | "claimCheck"
  | "review"
  | "chairman"
  | "verifier"
  | "arrange"
  | "diagram"
  | "sketch"
  | "ocr"
  | "rerank"
  | "summary"
  | "embed"
  | "storyWriter"
  | "styleVision";

export interface LengthChoice {
  id: string;
  label: string;
  /** added after the prompt, e.g. "Answer in at most 3 sentences." */
  text?: string;
  /** max_tokens used when the user hasn't set one */
  maxTokens?: number;
}

export interface TaskDef {
  id: TaskId;
  group: TaskGroup;
  label: string;
  /** one line under the label */
  hint: string;
  kind: TaskKind;
  /** families tried in order for the default model */
  families?: PickerFamily[];
  /** "answer": the topic's answer model is the default */
  defaultIsAnswer?: boolean;
  /** the editable instructions */
  prompt?: string;
  /** what the app always adds (shown read-only): formats it needs to read the reply */
  fixed?: string;
  lengths?: LengthChoice[];
  defaultLength?: string;
  /** settings for a model the user never tuned for this task (cheap tasks think little) */
  base?: Partial<ModelSettings>;
  /** the model choice is made elsewhere (e.g. each council member reviews with its own model) */
  noModel?: boolean;
}

/** Saved choices for one task. Settings are kept per model, so switching back keeps them. */
export interface TaskSettings {
  model?: string;
  prompt?: string;
  length?: string;
  settings?: Record<string, ModelSettings>;
}
export type TaskMap = Partial<Record<TaskId, TaskSettings>>;

const LOW: Partial<ModelSettings> = { reasoning: { effort: "low" } };
const sentences = (n: number, max: number): LengthChoice => ({ id: `s${n}`, label: n === 1 ? "1 sentence" : `${n} sentences`, text: `Answer in at most ${n} sentence${n > 1 ? "s" : ""}.`, maxTokens: max });

export const TASKS: TaskDef[] = [
  {
    id: "answer",
    group: "Chat",
    label: "Answers",
    hint: "Every question in the chat. Can also be changed per question.",
    kind: "text",
    families: ["gemini-pro"],
  },
  {
    id: "quick",
    group: "Chat",
    label: "Quick answers",
    hint: "Short side answers about highlighted words.",
    kind: "text",
    families: ["gemini-flash", "gemini-pro"],
    prompt: "Answer the question briefly and accurately, in plain words. Keep only what matters most. If you are not sure, say so.",
    lengths: [sentences(1, 800), sentences(3, 1500), { id: "p1", label: "1 paragraph", text: "Answer in one short paragraph.", maxTokens: 2500 }, { id: "p2", label: "2 paragraphs", text: "Answer in at most two short paragraphs.", maxTokens: 4000 }],
    defaultLength: "s3",
    base: LOW,
  },
  {
    id: "quickCheck",
    group: "Chat",
    label: "Quick check",
    hint: "A second model checks a quick answer: ✓, ? or ✗ with a reason.",
    kind: "text",
    families: ["claude-sonnet", "gemini-flash"],
    prompt: "Check the short answer below for factual accuracy and for anything important it leaves out. Be strict but fair.",
    fixed: 'Reply with JSON only: {"verdict":"ok"|"unsure"|"wrong","reason":"one sentence"}.',
    base: { ...LOW, max_tokens: 3000 },
  },
  {
    id: "claimCheck",
    group: "Chat",
    label: "Claim check",
    hint: "Splits highlighted text into claims: supported, uncertain or disputed.",
    kind: "text",
    families: ["claude-sonnet", "gemini-pro"],
    prompt: "Split the text into its distinct factual claims and judge each one on the evidence you know: supported, uncertain or disputed. Give a one-sentence reason for each.",
    fixed: 'Reply with JSON only: {"claims":[{"claim":"…","quote":"the words it comes from","verdict":"supported"|"uncertain"|"disputed","reason":"…"}]}.',
    lengths: [
      { id: "c5", label: "Up to 5 claims", text: "List at most 5 claims.", maxTokens: 4000 },
      { id: "c10", label: "Up to 10", text: "List at most 10 claims.", maxTokens: 6000 },
      { id: "c20", label: "Up to 20", text: "List at most 20 claims.", maxTokens: 10000 },
    ],
    defaultLength: "c10",
    base: LOW,
  },
  {
    id: "review",
    group: "Council",
    label: "Peer review",
    hint: "Members rank each other's anonymized answers, each with its own model.",
    kind: "text",
    noModel: true,
    prompt: "1. Evaluate each response individually: what it does well and what it does poorly, focusing on accuracy and insight.\n2. Then rank them from best to worst.",
    fixed: 'Reply with JSON only: {"evaluation":"…","ranking":["Response C","Response A",…]}.',
    lengths: [
      { id: "short", label: "Short", text: "Keep the evaluation under 150 words.", maxTokens: 4000 },
      { id: "standard", label: "Standard", text: "Keep the evaluation under 300 words.", maxTokens: 8000 },
      { id: "detailed", label: "Detailed", maxTokens: 12000 },
    ],
    defaultLength: "standard",
  },
  {
    id: "chairman",
    group: "Council",
    label: "Chairman",
    hint: "Writes the council's final answer from the members' text only.",
    kind: "text",
    defaultIsAnswer: true,
    prompt:
      "You are the Chairman of an LLM Council. Several models answered the learner's message; their answers (Response A, B, …) and peer reviews follow. Write the single best final answer, following the system prompt's style.\nGrounding rules (strict):\n- Use ONLY information that appears in the council's responses. Add nothing from your own knowledge or any other source.\n- Where members disagree, say so and name the responses.\n- If something the learner needs is not covered by the council, write \"Not covered by the council: …\" instead of filling it in.\n- Weigh the peer rankings when choosing between conflicting claims.",
    fixed: "End every paragraph and every list item with the labels of the responses it comes from, in square brackets, e.g. [A, C].",
  },
  {
    id: "verifier",
    group: "Council",
    label: "Grounding check",
    hint: "Checks every point of the chairman against the members' answers.",
    kind: "text",
    families: ["gemini-flash", "gemini-pro"],
    prompt: "You check grounding. For each chairman point, decide whether it is supported by the council responses (stated or directly implied there). Do not use outside knowledge: a true statement that isn't in the responses is NOT supported.",
    fixed: 'Reply with JSON only: {"results":[{"id":"…","supported":true|false,"quote":"short supporting quote or empty"}]}.',
    base: { ...LOW, max_tokens: 6000 },
  },
  {
    id: "arrange",
    group: "Views",
    label: "Arrange for views",
    hint: "Places the sentences of an answer or a selection into levels, groups and links. It never rewrites them.",
    kind: "text",
    families: ["gemini-flash", "gemini-pro"],
    prompt: "Arrange the numbered sentences below so a learner can see their structure: what subject they belong to, broad to narrow, how they group, which are foundations, steps and conclusions, and which build on which. Use short labels. Never rewrite or summarize a sentence; refer to sentences only by their ids.",
    base: { ...LOW, max_tokens: 12000 },
  },
  {
    id: "diagram",
    group: "Views",
    label: "Diagrams",
    hint: "Concept maps, comparisons, timelines and other diagrams of a selection.",
    kind: "text",
    families: ["gemini-flash", "gemini-pro"],
    prompt: "Turn the numbered sentences below into the requested diagram. Every element must cite the sentence ids it comes from. Use short labels; add nothing that isn't in the sentences.",
    lengths: [
      { id: "e8", label: "Up to 8 elements", text: "Use at most 8 elements.", maxTokens: 6000 },
      { id: "e16", label: "Up to 16", text: "Use at most 16 elements.", maxTokens: 9000 },
      { id: "e30", label: "Up to 30", text: "Use at most 30 elements.", maxTokens: 14000 },
    ],
    defaultLength: "e16",
    base: LOW,
  },
  {
    id: "sketch",
    group: "Views",
    label: "Drawing (sketches and story shapes)",
    hint: "Draws pictures as small vector graphics (SVG).",
    kind: "text",
    families: ["claude-sonnet", "gemini-pro"],
    prompt: "Draw the described scene as a single SVG illustration.",
    fixed: 'Rules: viewBox="0 0 400 300"; flat shapes, paths and gradients only; no text, no <image>, no scripts, no external links; at most 5000 characters. Reply with the <svg> element only.',
    base: { ...LOW, max_tokens: 8000 },
  },
  {
    id: "ocr",
    group: "Photos",
    label: "Text from images",
    hint: "Reads the text in photos and screenshots so you can highlight it.",
    kind: "vision",
    families: ["gemini-flash", "gemini-pro"],
    prompt: "Copy all the text in the image exactly, in reading order. Keep paragraphs and line breaks. Don't describe the image.",
    fixed: "Reply with the text only.",
    base: { ...LOW, max_tokens: 6000 },
  },
  {
    id: "rerank",
    group: "Search and memory",
    label: "Search reranking",
    hint: "Picks the best matches after the meaning search.",
    kind: "text",
    families: ["claude-sonnet", "gemini-pro"],
    prompt: "Pick the candidates that best match the concept, best first, at most 5.",
    fixed: 'Reply with JSON only: {"results":[{"id":"...","why":"one short line"}]}.',
    base: { ...LOW, max_tokens: 4000 },
  },
  {
    id: "summary",
    group: "Search and memory",
    label: "Fresh-branch summary",
    hint: "Summarizes a long branch so it can continue in a fresh one.",
    kind: "text",
    families: ["gemini-flash", "gemini-pro"],
    prompt: "Summarize the conversation below so it can be continued in a fresh thread. Keep the definitions and conclusions reached.",
    fixed: "Reply with plain text only.",
    lengths: [
      { id: "w80", label: "80 words", text: "Keep it under 80 words.", maxTokens: 2000 },
      { id: "w150", label: "150 words", text: "Keep it under 150 words.", maxTokens: 3000 },
      { id: "w300", label: "300 words", text: "Keep it under 300 words.", maxTokens: 4000 },
    ],
    defaultLength: "w150",
    base: LOW,
  },
  {
    id: "embed",
    group: "Search and memory",
    label: "Embeddings (search)",
    hint: "Turns answers into vectors for search by meaning.",
    kind: "embed",
  },
  {
    id: "storyWriter",
    group: "Stories",
    label: "Story writer",
    hint: "Writes story slides. Its instructions are the storytelling style in Settings › Story.",
    kind: "text",
    defaultIsAnswer: true,
    base: { max_tokens: 12000 },
  },
  {
    id: "styleVision",
    group: "Stories",
    label: "Style from screenshots",
    hint: "Describes the look of screenshots you add to a story style.",
    kind: "vision",
    families: ["gemini-flash", "gemini-pro", "claude-sonnet"],
    prompt: "Describe the visual style of these images so an illustrator could reproduce it: palette, line weight, shapes, textures, background, composition and mood. One short paragraph, no mention of the subject matter.",
    base: { ...LOW, max_tokens: 2000 },
  },
];

export const TASK: Record<TaskId, TaskDef> = Object.fromEntries(TASKS.map((t) => [t.id, t])) as Record<TaskId, TaskDef>;
export const TASK_GROUPS: TaskGroup[] = ["Chat", "Council", "Views", "Photos", "Search and memory", "Stories"];

const visionCapable = (m: ModelInfo) => !!m.architecture?.input_modalities?.includes("image");

/** The model a task uses when the user hasn't chosen one. */
export function defaultTaskModel(def: TaskDef, models: ModelInfo[], embedModels: ModelInfo[], answerModel?: string): string | undefined {
  if (def.kind === "embed") return defaultEmbeddingModel(embedModels);
  if (def.defaultIsAnswer) return answerModel;
  const pool = def.kind === "vision" ? models.filter(visionCapable) : models;
  for (const f of def.families ?? []) {
    const m = newestOf(pool, f);
    if (m) return m.id;
  }
  if (def.kind === "vision") return [...pool].filter((m) => !m.id.includes(":")).sort((a, b) => (b.created ?? 0) - (a.created ?? 0))[0]?.id ?? answerModel;
  return answerModel;
}

export function lengthOf(def: TaskDef, saved?: TaskSettings): LengthChoice | undefined {
  if (!def.lengths?.length) return undefined;
  return def.lengths.find((l) => l.id === saved?.length) ?? def.lengths.find((l) => l.id === def.defaultLength) ?? def.lengths[0];
}

/** The instructions sent: the (edited) prompt, anything the caller adds, the length rule and the format the app needs. */
export function taskPrompt(def: TaskDef, saved?: TaskSettings, middle?: string): string {
  return [saved?.prompt ?? def.prompt ?? "", middle ?? "", lengthOf(def, saved)?.text ?? "", def.fixed ?? ""].map((x) => x.trim()).filter(Boolean).join("\n\n");
}

/** Settings for the task's model: what the user saved for it, else the model's defaults with the task's base. */
export function taskModelSettings(def: TaskDef, saved: TaskSettings | undefined, model: ModelInfo): ModelSettings {
  const own = saved?.settings?.[model.id];
  const base: ModelSettings = { ...defaultSettings(model), ...def.base, reasoning: { ...defaultSettings(model).reasoning, ...def.base?.reasoning } };
  const s: ModelSettings = own ? { ...own, reasoning: { ...own.reasoning } } : base;
  // the length choice sets max_tokens unless the user set it
  const len = lengthOf(def, saved);
  if (s.max_tokens === undefined && len?.maxTokens) s.max_tokens = len.maxTokens;
  return s;
}

/**
 * One-time move of the older, scattered model choices into the task list (settings saved before tasks existed).
 * The answer keeps using `roleModels.answer`, `modelSettings` and the system prompt.
 */
export function migrateTasks(old: {
  tasks?: TaskMap;
  roleModels?: { answer?: string; tags?: string; rerank?: string; embed?: string };
  council?: { chairman?: string; verifier?: string };
  story?: { storyModel?: string; drawModel?: string };
}): TaskMap {
  if (old.tasks) return old.tasks;
  const t: TaskMap = {};
  const put = (id: TaskId, model?: string) => {
    if (model) t[id] = { model };
  };
  put("answer", old.roleModels?.answer);
  put("summary", old.roleModels?.tags);
  put("rerank", old.roleModels?.rerank);
  put("embed", old.roleModels?.embed);
  put("chairman", old.council?.chairman);
  put("verifier", old.council?.verifier);
  put("storyWriter", old.story?.storyModel);
  put("sketch", old.story?.drawModel);
  return t;
}
