import { db, uid } from "./db";
import { modelInfo, modelsStore, settingsStore } from "./store";
import { completeJSON, completeText, describeImages, speak } from "./openrouter";
import { buildRequestParams } from "./modelRules";
import { cardAnswer, roleModel, settingsFor } from "./ai";
import { outlineText, subsetOutline } from "./answer";
import { newestOf } from "./models";
import { indexCards, pathToRoot } from "./tree";
import { drawPrompt, normalizeStory, sanitizeSvg, STORY_SCHEMA, storyPrompt, type StyleId } from "./storyStyles";
import type { Story, StoryScope, StorySlide } from "./storyTypes";

const key = () => settingsStore.get().apiKey;
const cfg = () => settingsStore.get().story;

export function drawModel(): string {
  return cfg().drawModel || newestOf(modelsStore.get().models, "claude-sonnet")?.id || roleModel("answer") || "";
}
export function voiceModel(): string {
  const list = modelsStore.get().speechModels ?? [];
  return cfg().voiceModel || list.find((m) => /gpt-4o-mini-tts/.test(m.id))?.id || list[0]?.id || "";
}
export function visionModel(): string {
  const ms = modelsStore.get().models.filter((m) => (m.architecture as { input_modalities?: string[] } | undefined)?.input_modalities?.includes("image"));
  const pref = cfg().storyModel || roleModel("answer") || "";
  return ms.find((m) => m.id === pref)?.id ?? ms.sort((a, b) => (b.created ?? 0) - (a.created ?? 0))[0]?.id ?? pref;
}

/** The material a story teaches: one answer, one pyramid, or the whole branch down to an answer. */
async function material(story: Story): Promise<string> {
  const cards = await db.cards.where("sessionId").equals(story.sessionId).toArray();
  const card = cards.find((c) => c.id === story.cardId);
  if (!card) throw new Error("The answer for this story no longer exists.");
  const ans = cardAnswer(card);
  if (story.scope === "pyramid" && ans && story.nodeIds?.length) return `Question: ${card.question}\n${subsetOutline(ans, story.nodeIds)}`;
  if (story.scope === "branch") {
    return pathToRoot(indexCards(cards), card.id)
      .map((c) => `Question: ${c.question}\n${outlineText(cardAnswer(c))}`)
      .join("\n\n");
  }
  return `Question: ${card.question}\n${outlineText(ans)}`;
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
      const modelId = cfg().storyModel || session?.answerModel || roleModel("answer") || "";
      const model = modelInfo(modelId);
      const { data } = await completeJSON<unknown>({
        apiKey: key(),
        model,
        messages: [
          { role: "system", content: storyPrompt({ ...cfg(), style: story.style as StyleId }, story.style as StyleId) },
          { role: "user", content: await material(story) },
        ],
        schemaName: "storyboard",
        schema: STORY_SCHEMA,
        extra: buildRequestParams({ ...settingsFor(modelId), max_tokens: 12000 }, model),
      });
      const s = normalizeStory(data, cfg().slides);
      const slides: StorySlide[] = s.slides.map((x) => ({ ...x, picture: "shapes", pictureStatus: "pending", audioStatus: "pending" }));
      await db.stories.update(id, { title: s.title, scenario: s.scenario, slides });
      story = (await db.stories.get(id))!;
    }
    await db.stories.update(id, { status: "running" });
    await Promise.all(story.slides.map((_, i) => Promise.all([drawSlide(id, i), narrateSlide(id, i)])));
    const done = (await db.stories.get(id))!;
    const failed = done.slides.some((s) => s.pictureStatus === "error" || s.audioStatus === "error");
    await db.stories.update(id, { status: failed ? "error" : "done", error: failed ? "Some pictures or narration failed. Tap Regenerate on that slide." : undefined });
  } catch (e) {
    await db.stories.update(id, { status: "error", error: e instanceof Error ? e.message : String(e) });
  } finally {
    running.delete(id);
  }
}

async function patchSlide(id: string, i: number, patch: Partial<StorySlide>) {
  await db.transaction("rw", db.stories, async () => {
    const st = await db.stories.get(id);
    if (!st?.slides[i]) return;
    st.slides[i] = { ...st.slides[i], ...patch };
    await db.stories.put(st);
  });
}

/** Shapes drawn by the drawing model as a sanitized SVG. (AI images and video are handled in media.ts.) */
export async function drawSlide(id: string, i: number, force = false): Promise<void> {
  const st = await db.stories.get(id);
  const slide = st?.slides[i];
  if (!st || !slide || slide.picture !== "shapes" || (slide.pictureStatus === "done" && slide.svg && !force)) return;
  await patchSlide(id, i, { pictureStatus: "running", pictureError: undefined });
  try {
    const m = modelInfo(drawModel());
    const text = await completeText({
      apiKey: key(),
      model: m,
      messages: [
        { role: "system", content: drawPrompt(cfg()) },
        { role: "user", content: `Scene: ${slide.visual}\nIt illustrates: ${slide.narration}` },
      ],
      extra: buildRequestParams({ reasoning: { effort: "low" }, max_tokens: 8000 }, m),
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
  if (!model) return patchSlide(id, i, { audioStatus: "error", audioError: "Choose a voice model in Settings › Story." });
  await patchSlide(id, i, { audioStatus: "running", audioError: undefined });
  try {
    const blob = await speak(key(), { model, input: slide.narration, voice: cfg().voice, speed: cfg().speechSpeed });
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
  return speak(key(), { model: voiceModel(), input: text, voice: cfg().voice, speed: cfg().speechSpeed });
}

/** Turn reference screenshots into a reusable written style description. */
export async function styleFromScreenshots(dataUrls: string[]): Promise<string> {
  const text = await describeImages(
    key(),
    visionModel(),
    "Describe the visual style of these images so an illustrator could reproduce it: palette, line weight, shapes, textures, background, composition and mood. One short paragraph, no mention of the subject matter.",
    dataUrls,
  );
  if (!text.trim()) throw new Error("No description came back.");
  return text.trim();
}

export async function resumeStories(): Promise<void> {
  const open = (await db.stories.toArray()).filter((s) => s.status === "pending" || s.status === "running");
  for (const s of open) void runStory(s.id);
}
