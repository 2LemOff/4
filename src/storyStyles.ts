import type { StorySlide } from "./storyTypes";

export type StyleId = "ted-ed" | "scienceclic" | "custom";

/** Storytelling styles. Descriptions come from TED-Ed's making-of material and ScienceClic's own channel blurb. */
export const STORY_STYLES: Record<StyleId, { label: string; rules: string; look: LookId }> = {
  "ted-ed": {
    label: "TED-Ed",
    look: "flat",
    rules:
      "Tell it as a TED-Ed style animated lesson. Open with a hook: a relatable character or a historical anecdote in a concrete scenario. Follow that character through the idea scene by scene, with the narrator guiding the viewer's eye to what is on screen. Build up to the concept rather than stating it first, and end on a short reflective question. Pictures: simple, flat, hand-drawn 2D illustrations, near-stick-figure characters, a few big settings, a warm colorful palette.",
  },
  scienceclic: {
    label: "ScienceClic",
    look: "dark-diagram",
    rules:
      "Explain it like ScienceClic: short, precise and visual-first, often about physics or maths. Use few or no characters. Build one visual model step by step across the scenes (grids, light cones, fields, particle paths, graphs), the way the channel uses its own drawings, animations and simulations. Narration is calm and exact, and a simple picture beats a long explanation. Pictures: clean geometric shapes and diagrams on a dark background, with glowing accent colors.",
  },
  custom: { label: "Custom", look: "flat", rules: "" },
};

export type LookId = "flat" | "line" | "dark-diagram" | "isometric" | "paper" | "chalk" | "custom";

export const LOOKS: Record<LookId, { label: string; description: string }> = {
  flat: { label: "Colorful flat vectors", description: "colorful flat vector illustration, bold simple shapes, soft gradients, friendly characters, light background" },
  line: { label: "Minimal line art", description: "minimal black line art on white, thin even strokes, one accent color, lots of empty space" },
  "dark-diagram": { label: "Geometric diagrams on dark", description: "clean geometric diagram on a near-black background, thin glowing lines in cyan, magenta and amber, grids and arrows" },
  isometric: { label: "Isometric", description: "isometric 3D-looking flat shapes, pastel palette, soft shadows" },
  paper: { label: "Paper cut-out", description: "layered paper cut-out look, overlapping flat shapes with drop shadows, muted warm colors" },
  chalk: { label: "Chalkboard sketch", description: "white and pastel chalk strokes on a dark green chalkboard, hand-drawn wobbly lines" },
  custom: { label: "From my description or screenshot", description: "" },
};

export interface StorySettings {
  style: StyleId;
  /** edited rules per style (empty = the preset) */
  rules: Partial<Record<StyleId, string>>;
  /** style notes taken from the user's screenshots, per style */
  notes: Partial<Record<StyleId, string>>;
  look: LookId;
  customLook: string;
  slides: 3 | 4;
  /** empty = the topic's model */
  storyModel: string;
  /** empty = newest Claude Sonnet */
  drawModel: string;
  picture: "shapes" | "image";
  voiceModel: string;
  voice: string;
  /** sent to the speech model where supported */
  speechSpeed: number;
  /** player speed (audio.playbackRate) */
  playbackRate: number;
  autoplay: boolean;
  imageModel: string;
  imageParams: Record<string, unknown>;
  videoModel: string;
  videoParams: Record<string, unknown>;
}

export const DEFAULT_STORY: StorySettings = {
  style: "ted-ed",
  rules: {},
  notes: {},
  look: "flat",
  customLook: "",
  slides: 4,
  storyModel: "",
  drawModel: "",
  picture: "shapes",
  voiceModel: "",
  voice: "alloy",
  speechSpeed: 1,
  playbackRate: 1,
  autoplay: true,
  imageModel: "",
  imageParams: {},
  videoModel: "",
  videoParams: {},
};

export const styleRules = (s: StorySettings, id: StyleId = s.style) => (s.rules[id] ?? STORY_STYLES[id].rules).trim();
export const lookText = (s: StorySettings) => (s.look === "custom" ? s.customLook : LOOKS[s.look].description).trim();

/** System prompt for writing the story. */
export function storyPrompt(s: StorySettings, styleId: StyleId = s.style): string {
  const notes = s.notes[styleId]?.trim();
  return [
    `Turn the learning material below into a short narrated storyboard of exactly ${s.slides} scenes that teaches it.`,
    styleRules(s, styleId),
    notes ? `Style notes from the learner's reference screenshots: ${notes}` : "",
    "Each scene has: a 2-6 word heading; narration of 1-3 spoken sentences (vivid, concrete, accurate to the material; no new facts); and a visual: one memorable picture described in one or two sentences, with no text or letters inside the picture.",
    'Reply with JSON only: {"title":"…","scenario":"one sentence","slides":[{"heading":"…","narration":"…","visual":"…"}]}.',
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** System prompt for drawing one scene as SVG shapes. */
export function drawPrompt(s: StorySettings): string {
  return `Draw the described scene as a single SVG illustration. Look: ${lookText(s) || LOOKS.flat.description}.
Rules: viewBox="0 0 400 300"; flat shapes, paths and gradients only; no text, no <image>, no scripts, no external links; at most 5000 characters. Reply with the <svg> element only.`;
}

export const STORY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "scenario", "slides"],
  properties: {
    title: { type: "string" },
    scenario: { type: "string" },
    slides: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["heading", "narration", "visual"],
        properties: { heading: { type: "string" }, narration: { type: "string" }, visual: { type: "string" } },
      },
    },
  },
} as const;

export function normalizeStory(raw: unknown, count: number): { title: string; scenario: string; slides: Pick<StorySlide, "heading" | "narration" | "visual">[] } {
  const r = (raw ?? {}) as Record<string, any>;
  const slides = (Array.isArray(r.slides) ? r.slides : [])
    .map((x: any) => ({ heading: String(x?.heading ?? "").trim(), narration: String(x?.narration ?? "").trim(), visual: String(x?.visual ?? "").trim() }))
    .filter((x: { narration: string }) => x.narration)
    .slice(0, count);
  if (!slides.length) throw new Error("The story came back empty.");
  return { title: String(r.title ?? "").trim() || "Story", scenario: String(r.scenario ?? "").trim(), slides };
}

export const MAX_SVG = 12000;

/**
 * Keep only a self-contained SVG: no scripts, event handlers, foreignObject, embedded images or external links.
 * It's also only ever shown through an <img> data URI, where scripts can't run anyway.
 */
export function sanitizeSvg(text: string): string | undefined {
  const m = text.match(/<svg[\s\S]*<\/svg>/i);
  if (!m) return undefined;
  let svg = m[0];
  if (svg.length > MAX_SVG) return undefined;
  svg = svg
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script[^>]*\/>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, "")
    .replace(/<image\b[\s\S]*?(\/>|<\/image\s*>)/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(?:xlink:)?href\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*')/gi, "")
    .replace(/@import[^;]*;?/gi, "")
    .replace(/url\(\s*['"]?(?!#)[^)]*\)/gi, "none");
  if (!/xmlns=/.test(svg)) svg = svg.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return svg;
}

export const svgDataUri = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
