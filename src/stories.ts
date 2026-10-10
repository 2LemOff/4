import { db, uid } from "./db";
import { modelsStore, settingsStore, updateSettings } from "./store";
import { completeJSON, completeText, describeImages, OpenRouterError, speak } from "./openrouter";
import { cardAnswer } from "./ai";
import { outlineText, subsetOutline } from "./answer";
import { indexCards, pathToRoot } from "./tree";
import { lookLine, normalizeStory, sanitizeSvg, STORY_SCHEMA, storyPrompt, type StyleId } from "./storyStyles";
import { taskModel, taskSetup } from "./taskConfig";
import type { Story, StoryScope, StorySlide } from "./storyTypes";
import type { Card } from "./types";
import { imageSlide, patchSlide, resumeVideos } from "./media";

const key = () => settingsStore.get().apiKey;
const cfg = () => settingsStore.get().story;

export const drawModel = () => taskModel("sketch");
export function voiceModel(): string {
  const list = (modelsStore.get().speechModels ?? []).filter((m) => !m.id.includes(":"));
  return cfg().voiceModel || list.find((m) => /gpt-4o-mini-tts/.test(m.id))?.id || [...list].sort((a, b) => (b.created ?? 0) - (a.created ?? 0))[0]?.id || "";
}

/** The voices a speech model lists (`supported_voices`); empty when the model doesn't say. */
export const voicesFor = (model: string): string[] => modelsStore.get().speechModels?.find((m) => m.id === model)?.supported_voices ?? [];

/** The chosen voice when the model offers it, otherwise the model's first voice. */
export function voiceName(model = voiceModel()): string {
  const voices = voicesFor(model);
  const v = cfg().voice;
  if (!voices.length) return v || "alloy";
  return voices.includes(v) ? v : voices[0];
}

/** Speak with the narration settings. A model that refuses `speed` is remembered and asked again without it. */
async function narrate(input: string): Promise<Blob> {
  const model = voiceModel();
  const s = cfg();
  const speed = s.noSpeedModels.includes(model) ? undefined : s.speechSpeed;
  const opts = { model, input, voice: voiceName(model), speed, instructions: s.narratorStyle };
  try {
    return await speak(key(), opts);
  } catch (e) {
    if (!(e instanceof OpenRouterError) || e.status !== 400 || !speed || speed === 1) throw e;
    updateSettings((x) => ({ story: { ...x.story, noSpeedModels: [...new Set([...x.story.noSpeedModels, model])] } }));
    return speak(key(), { ...opts, speed: undefined });
  }
}
export const visionModel = () => taskModel("styleVision");

/** An answer as text for a story: full-text answers as written, pyramid answers as an outline. */
const answerText = (c: Card) => (c.answer && !c.answer.converted ? outlineText(c.answer) : c.assistant?.content || outlineText(cardAnswer(c)));

/** The material a story teaches: one answer, one pyramid, or the whole branch down to an answer. */
async function material(story: Story): Promise<string> {
  const cards = await db.cards.where("sessionId").equals(story.sessionId).toArray();
  const card = cards.find((c) => c.id === story.cardId);
  if (!card) throw new Error("The answer for this story no longer exists.");
  const ans = cardAnswer(card);
  if (story.scope === "pyramid" && ans && story.nodeIds?.length) return `Question: ${card.question}\n${subsetOutline(ans, story.nodeIds)}`;
  if (story.scope === "branch") {
    return pathToRoot(indexCards(cards), card.id)
      .map((c) => `Question: ${c.question}\n${answerText(c)}`)
      .join("\n\n");
  }
  return `Question: ${card.question}\n${answerText(card)}`;
}

export async function createStory(o: { sessionId: string; cardId: string; scope: StoryScope; nodeIds?: string[]; style?: StyleId }): Promise<string> {
  const story: Story = {
    id: uid(),
    sessionId: o.sessionId,
    cardId: o.cardId,
    scope: o.scope,
    nodeIds: o.nodeIds,
    title: "",
    scenario: "",
    style: o.style ?? cfg().style,
    slides: [],
    status: "pending",
    createdAt: Date.now(),
  };
  await db.stories.put(story);
  void runStory(story.id);
  return story.id;
}

const running = new Set<string>();

/** Write the story, then draw and narrate every slide. Saved as it goes; resumes after a restart. */
export async function runStory(id: string): Promise<void> {
  if (running.has(id)) return;
  running.add(id);
  try {
    let story = await db.stories.get(id);
    if (!story) return;
    if (!key()) throw new Error("Connect OpenRouter in Settings first.");
    if (!story.slides.length) {
      await db.stories.update(id, { status: "running", error: undefined });
      const session = await db.sessions.get(story.sessionId);
      const writer = taskSetup("storyWriter", { answerModel: session?.answerModel });
      const { data } = await completeJSON<unknown>({
        apiKey: key(),
        model: writer.info,
        messages: [
          { role: "system", content: storyPrompt({ ...cfg(), style: story.style as StyleId }, story.style as StyleId) },
          { role: "user", content: await material(story) },
        ],
        schemaName: "storyboard",
        schema: STORY_SCHEMA,
        extra: writer.params,
      });
      const s = normalizeStory(data, cfg().slides);
      const slides: StorySlide[] = s.slides.map((x) => ({ ...x, picture: cfg().picture, pictureStatus: "pending", audioStatus: "pending" }));
      await db.stories.update(id, { title: s.title, scenario: s.scenario, slides });
      story = (await db.stories.get(id))!;
    }
    await db.stories.update(id, { status: "running" });
    await Promise.all(story.slides.map((s, i) => Promise.all([s.picture === "image" ? imageSlide(id, i) : drawSlide(id, i), narrateSlide(id, i)])));
    const done = (await db.stories.get(id))!;
    const failed = done.slides.some((s) => s.pictureStatus === "error" || s.audioStatus === "error");
    await db.stories.update(id, { status: failed ? "error" : "done", error: failed ? "Some pictures or narration failed. Tap Regenerate on that slide." : undefined });
  } catch (e) {
    await db.stories.update(id, { status: "error", error: e instanceof Error ? e.message : String(e) });
  } finally {
    running.delete(id);
  }
}

/** Shapes drawn by the drawing model as a sanitized SVG. (AI images and video are in media.ts.) */
export async function drawSlide(id: string, i: number, force = false): Promise<void> {
  const st = await db.stories.get(id);
  const slide = st?.slides[i];
  if (!st || !slide || (!force && (slide.picture !== "shapes" || (slide.pictureStatus === "done" && slide.svg)))) return;
  await patchSlide(id, i, { picture: "shapes", pictureStatus: "running", pictureError: undefined });
  try {
    const t = taskSetup("sketch", { middle: lookLine(cfg()) });
    const text = await completeText({
      apiKey: key(),
      model: t.info,
      messages: [
        { role: "system", content: t.prompt },
        { role: "user", content: `Scene: ${slide.visual}\nIt illustrates: ${slide.narration}` },
      ],
      extra: t.params,
    });
    const svg = sanitizeSvg(text);
    if (!svg) throw new Error("The drawing model didn't return a usable SVG.");
    await patchSlide(id, i, { svg, pictureStatus: "done" });
  } catch (e) {
    await patchSlide(id, i, { pictureStatus: "error", pictureError: e instanceof Error ? e.message : String(e) });
  }
}

/** AI voice for one slide, saved on the phone. */
export async function narrateSlide(id: string, i: number, force = false): Promise<void> {
  const st = await db.stories.get(id);
  const slide = st?.slides[i];
  if (!st || !slide || (slide.audioStatus === "done" && slide.audioId && !force)) return;
  const model = voiceModel();
  if (!model) return patchSlide(id, i, { audioStatus: "error", audioError: "No voice model yet: open Settings › Story and tap Refresh models." });
  await patchSlide(id, i, { audioStatus: "running", audioError: undefined });
  try {
    const blob = await narrate(slide.narration);
    const mediaId = uid();
    await db.media.put({ id: mediaId, sessionId: st.sessionId, storyId: id, kind: "audio", mime: blob.type || "audio/mpeg", size: blob.size, label: `${st.title || "Story"} · narration ${i + 1}`, blob, createdAt: Date.now() });
    if (slide.audioId) await db.media.delete(slide.audioId);
    await patchSlide(id, i, { audioId: mediaId, audioStatus: "done" });
  } catch (e) {
    await patchSlide(id, i, { audioStatus: "error", audioError: e instanceof Error ? e.message : String(e) });
  }
}

/** A sample of the chosen voice (not saved). */
export async function previewVoice(text = "This is how your stories will sound."): Promise<Blob> {
  if (!voiceModel()) throw new Error("No voice model yet: tap Refresh models.");
  return narrate(text);
}

/** Turn reference screenshots into a reusable written style description. */
export async function styleFromScreenshots(dataUrls: string[]): Promise<string> {
  const t = taskSetup("styleVision");
  const text = await describeImages(key(), t.model, t.prompt, dataUrls);
  if (!text.trim()) throw new Error("No description came back.");
  return text.trim();
}

export async function resumeStories(): Promise<void> {
  const open = (await db.stories.toArray()).filter((s) => s.status === "pending" || s.status === "running");
  for (const s of open) void runStory(s.id);
  void resumeVideos();
}
