import type { OutlineSection, PromptToggles, SynthesisOptions, SynthesisPreset, SynthesisSettings } from "./types";

// ── System prompt ────────────────────────────────────────────────────────────

/** The two exact directives. Do not reword. */
export const DIRECTIVE_1 =
  "Never provide long, unbroken walls of text. Break answers into distinct, logical premises.";
export const DIRECTIVE_2 =
  "Speak in first principles. Assume the user will question the foundational logic of every claim you make.";

const INTRO =
  "You are Fractal, a tutor for a learner who explores a subject by questioning every answer you give.";
/** v1 wording, kept so saved prompts can be migrated */
export const OLD_PREMISE_FORMAT =
  "Write each premise as its own short paragraph of one to three sentences, with a blank line between paragraphs. Do not use headings, tables or long lists unless asked.";
const PREMISE_FORMAT =
  "Keep each premise short and self-contained: one claim per premise, stated plainly, with no filler.";
const PUSHBACK =
  "When the learner challenges something you said, re-examine it honestly: concede plainly if you were wrong, defend it with reasons if you were right, and say so when you are unsure.";

export const PROMPT_PARTS: Record<keyof PromptToggles, string> = {
  noWalls: DIRECTIVE_1,
  firstPrinciples: DIRECTIVE_2,
  premiseFormat: PREMISE_FORMAT,
  pushback: PUSHBACK,
};
const PART_ORDER = ["noWalls", "firstPrinciples", "premiseFormat", "pushback"] as const;

export const ALL_ON: PromptToggles = { noWalls: true, firstPrinciples: true, premiseFormat: true, pushback: true };

export function composeSystemPrompt(toggles: PromptToggles = ALL_ON, extra = ""): string {
  const parts = [INTRO, ...PART_ORDER.filter((k) => toggles[k]).map((k) => PROMPT_PARTS[k])];
  if (extra.trim()) parts.push(extra.trim());
  return parts.join("\n\n");
}
export const DEFAULT_SYSTEM_PROMPT = composeSystemPrompt();

/** Fixed (not editable) instructions for the pyramid answer format, added after the editable prompt. */
export const ANSWER_FORMAT_MARKER = "Answer format (required).";
export const ANSWER_FORMAT = `${ANSWER_FORMAT_MARKER} Reply with JSON only, nothing outside it:
{"groups":[{"id","title","parent"}],"nodes":[{"id","kind","text","group","from","title"}]}
- Build every answer up from the ground: kind "foundation" = a first principle or basic fact the rest rests on; "step" = a premise derived from earlier nodes; "conclusion" = what follows, with a 2-5 word "title".
- "from" lists the ids a node is derived from. When an idea already exists as a node in an earlier answer of this conversation, put that earlier id in "from" instead of restating it.
- Put foundations into categories ("groups"). A category can sit inside another via "parent", so related foundations stay together.
- If the question has parts that don't depend on each other, make separate pyramids (sets of nodes not linked by "from"), each with its own conclusion.
- Each node states one claim in at most 25 words. Usually 5-15 nodes.
- Start every new node and group id with the prefix given at the end of the user's message (e.g. "K7.n1", "K7.g1").
- Use null for "group", "parent" or "title" when there is none.`;

/** The frozen prompt a new session starts with: the editable prompt plus the fixed format section. */
export const sessionPrompt = (editable: string) => `${editable.trim()}\n\n${ANSWER_FORMAT}`;
export const usesPyramids = (systemPrompt: string) => systemPrompt.includes(ANSWER_FORMAT_MARKER);

/** Which built-in rules are present in the (possibly hand-edited) text. */
export function detectToggles(text: string): PromptToggles {
  return {
    noWalls: text.includes(DIRECTIVE_1),
    firstPrinciples: text.includes(DIRECTIVE_2),
    premiseFormat: text.includes(PREMISE_FORMAT),
    pushback: text.includes(PUSHBACK),
  };
}

export function setToggle(text: string, key: keyof PromptToggles, on: boolean): string {
  const part = PROMPT_PARTS[key];
  if (on) return text.includes(part) ? text : `${text.trimEnd()}\n\n${part}`;
  return text.replace(part, "").replace(/\n{3,}/g, "\n\n").trim();
}

// ── Synthesis ────────────────────────────────────────────────────────────────

export const PRESET_LABELS: Record<SynthesisPreset, string> = {
  outline: "Concept outline",
  notes: "Study notes",
  flashcards: "Q&A flashcards",
  argument: "Argument map",
  chapter: "Textbook chapter",
};

export const PRESET_PROMPTS: Record<SynthesisPreset, string> = {
  outline:
    "Read the whole branching tree of questions and answers below and compile it into one clean, single-page Concept Outline. Group related ideas into sections, state each concept as a short self-contained point, and keep the order a learner would need to understand it.",
  notes:
    "Turn the question tree below into concise study notes: definitions first, then key relationships, then common misconceptions the learner raised. Short bullet-style points, no filler.",
  flashcards:
    "Turn the question tree below into flashcards. Each point is a question on one side followed by its answer, written as “Q: … A: …”. Cover every distinct idea once.",
  argument:
    "Map the argument in the question tree below. Sections are claims; points under a section are the premises that support it and the objections the learner raised, each labelled “Premise:” or “Objection:”.",
  chapter:
    "Rewrite the question tree below as a short textbook chapter: an overview section, then sections that build on each other, written in clear explanatory prose (one idea per point).",
};

export const DEFAULT_SYNTHESIS_OPTIONS: SynthesisOptions = {
  depth: 2,
  length: "standard",
  examples: true,
  openQuestions: true,
  language: "English",
};

export const DEFAULT_SYNTHESIS: SynthesisSettings = {
  prompt: PRESET_PROMPTS.outline,
  preset: "outline",
  options: DEFAULT_SYNTHESIS_OPTIONS,
  model: "",
  categoryMode: "reuse",
};

export const OUTLINE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "category", "summary", "sections"],
  properties: {
    title: { type: "string" },
    category: { type: "string" },
    summary: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["heading", "points"],
        properties: {
          heading: { type: "string" },
          points: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["text", "cardIds"],
              properties: { text: { type: "string" }, cardIds: { type: "array", items: { type: "string" } } },
            },
          },
        },
      },
    },
  },
} as const;

export function composeSynthesisPrompt(s: SynthesisSettings, categories: string[]): string {
  const o = s.options;
  const lines = [
    s.prompt.trim(),
    "",
    "Options:",
    `- Use at most ${o.depth} level${o.depth > 1 ? "s" : ""} of headings.`,
    `- Length: ${o.length}.`,
    `- ${o.examples ? "Keep the examples that clarified an idea." : "Leave examples out."}`,
    `- ${o.openQuestions ? "Add a final section “Open questions” for questions the learner never resolved." : "Do not list open questions."}`,
    `- Write in ${o.language || "English"}.`,
    s.categoryMode === "reuse" && categories.length
      ? `- Category: choose one of the existing categories if it fits (${categories.join(", ")}); otherwise invent a short new one.`
      : "- Category: choose a short subject name such as “Economics” or “Biology”.",
    "",
    "Every card in the tree has an id in square brackets. For each point, list in cardIds the ids of the cards it came from.",
    "Respond with JSON only, matching: { title, category, summary, sections: [{ heading, points: [{ text, cardIds }] }] }.",
  ];
  return lines.join("\n");
}

export const TAG_PROMPT =
  "Give a 2-4 word topic tag for the question and answer below. Reply with JSON only: {\"tag\": \"...\"}.";

export const SEED_PROMPT =
  "Summarize the conversation below in under 150 words so it can be continued in a fresh thread. Keep the definitions and conclusions reached. Reply with plain text only.";

export function rerankPrompt(query: string, candidates: { id: string; tag: string; text: string }[]): string {
  const list = candidates.map((c) => `[${c.id}] (${c.tag}) ${c.text}`).join("\n");
  return `The learner is searching their notes: "${query}"\n\nCandidates:\n${list}\n\nPick the candidates that best match the concept, best first, at most 5. Reply with JSON only: {"results":[{"id":"...","why":"one short line"}]}.`;
}

export function serializeTree(
  cards: { id: string; parentId: string | null; question: string; anchor?: { text: string }; assistantText?: string }[],
): string {
  const kids = new Map<string | null, typeof cards>();
  for (const c of cards) {
    const k = c.parentId;
    kids.set(k, [...(kids.get(k) ?? []), c]);
  }
  const lines: string[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const c of kids.get(parent) ?? []) {
      const pad = "  ".repeat(depth);
      lines.push(`${pad}[${c.id}] ${c.anchor ? `On “${c.anchor.text}” — ` : ""}Q: ${c.question}`);
      if (c.assistantText) lines.push(`${pad}  A: ${c.assistantText.replace(/\n+/g, " ")}`);
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return lines.join("\n");
}

export function outlineToMarkdown(title: string, summary: string, sections: OutlineSection[]): string {
  const body = sections.map((s) => `## ${s.heading}\n${s.points.map((p) => `- ${p.text}`).join("\n")}`).join("\n\n");
  return `# ${title}\n\n${summary}\n\n${body}\n`;
}
