import { db, uid } from "./db";
import { createStore, settingsStore, updateSettings } from "./store";
import { downloadVideo, generateImage, getVideo, imageModelEndpoints, listImageModels, listVideoModels, OpenRouterError, submitVideo, type VideoJob } from "./openrouter";
import {
  defaultsFor,
  estimateImagePrice,
  estimateVideoPrice,
  imageControls,
  maxReferences,
  preferredDuration,
  requestParams,
  supportedFromError,
  videoControls,
  videoPhase,
  type MediaControl,
  type PriceRange,
  type VideoModel,
} from "./mediaSettings";
import { lookText, LOOKS, type StyleId } from "./storyStyles";
import type { PictureType, StorySlide } from "./storyTypes";

const key = () => settingsStore.get().apiKey;
const cfg = () => settingsStore.get().story;

// ── Model metadata (loaded on demand) ────────────────────────────────────────

type ImageModel = Awaited<ReturnType<typeof listImageModels>>[number];
type Endpoint = Awaited<ReturnType<typeof imageModelEndpoints>>[number];

export interface MediaState {
  imageModels: ImageModel[];
  videoModels: VideoModel[];
  endpoints: Record<string, Endpoint[]>;
  loading: boolean;
  loaded: boolean;
  error?: string;
}
export const mediaStore = createStore<MediaState>({ imageModels: [], videoModels: [], endpoints: {}, loading: false, loaded: false });

let loading: Promise<void> | undefined;
export function loadMediaModels(force = false): Promise<void> {
  if (loading && !force) return loading;
  if (mediaStore.get().loaded && !force) return Promise.resolve();
  mediaStore.set({ ...mediaStore.get(), loading: true, error: undefined });
  loading = (async () => {
    const [imgs, vids] = await Promise.allSettled([listImageModels(), listVideoModels()]);
    const cur = mediaStore.get();
    const err = [imgs, vids].find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    mediaStore.set({
      ...cur,
      imageModels: imgs.status === "fulfilled" ? imgs.value : cur.imageModels,
      videoModels: vids.status === "fulfilled" ? vids.value : cur.videoModels,
      loading: false,
      loaded: true,
      error: err ? String(err.reason?.message ?? err.reason) : undefined,
    });
    const m = imageModel();
    if (m) await loadEndpoints(m);
  })().finally(() => (loading = undefined));
  return loading;
}

export async function loadEndpoints(model: string): Promise<void> {
  if (!model || mediaStore.get().endpoints[model]) return;
  try {
    const eps = await imageModelEndpoints(model);
    const cur = mediaStore.get();
    mediaStore.set({ ...cur, endpoints: { ...cur.endpoints, [model]: eps } });
  } catch {
    /* fall back to the model-level descriptors */
  }
}

const created = (x: object) => Number((x as { created?: unknown }).created ?? 0);
const newest = <T extends object>(xs: T[]): T | undefined => [...xs].sort((a, b) => created(b) - created(a))[0];

export const imageModel = () => cfg().imageModel || newest(mediaStore.get().imageModels)?.id || "";
export const videoModel = () => cfg().videoModel || newest(mediaStore.get().videoModels)?.id || "";

/** Everything the UI needs to show image settings and a price for the chosen (or given) model. */
export function imageSetup(model = imageModel()): { model: string; controls: MediaControl[]; values: Record<string, unknown>; price?: PriceRange; maxRefs: number } {
  const st = mediaStore.get();
  const m = st.imageModels.find((x) => x.id === model);
  const ep = st.endpoints[model]?.[0];
  const controls = imageControls(m?.supported_parameters, ep?.supported_parameters);
  const values = defaultsFor(controls, cfg().imageParams, { aspect_ratio: "4:3", resolution: "1K" });
  const maxRefs = maxReferences(ep?.supported_parameters ?? m?.supported_parameters);
  const refs = cfg().useRefs ? Math.min(cfg().refImages.length, maxRefs) : 0;
  return {
    model,
    controls,
    values,
    price: estimateImagePrice(ep?.pricing ?? (m as Record<string, unknown> | undefined)?.pricing, values, refs),
    maxRefs,
  };
}

export function videoSetup(model = videoModel()): { model: string; info?: VideoModel; controls: MediaControl[]; values: Record<string, unknown>; price?: PriceRange } {
  const info = mediaStore.get().videoModels.find((x) => x.id === model);
  const controls = info ? videoControls(info) : [];
  const values = defaultsFor(controls, cfg().videoParams, { aspect_ratio: "4:3", duration: preferredDuration(info?.supported_durations) });
  return {
    model,
    info,
    controls,
    values,
    price: estimateVideoPrice(info?.pricing_skus, { duration: values.duration as number, resolution: values.resolution as string, audio: cfg().videoSound }),
  };
}

// ── Slides ───────────────────────────────────────────────────────────────────

export async function patchSlide(id: string, i: number, patch: Partial<StorySlide>) {
  await db.transaction("rw", db.stories, async () => {
    const st = await db.stories.get(id);
    if (!st?.slides[i]) return;
    st.slides[i] = { ...st.slides[i], ...patch };
    await db.stories.put(st);
  });
}

export const setPicture = (id: string, i: number, picture: PictureType) => patchSlide(id, i, { picture });

function scenePrompt(slide: StorySlide, style: string): string {
  const s = cfg();
  const notes = s.notes[style as StyleId]?.trim();
  return [slide.visual, `Style: ${lookText(s) || LOOKS.flat.description}.`, notes ? `Reference style: ${notes}` : "", "No text, letters or captions in the picture."].filter(Boolean).join(" ");
}

/** Re-save a picture as WebP (quality 0.85) to save space; SVG and anything the browser can't re-encode stay as they are. */
async function compact(blob: Blob): Promise<Blob> {
  if (blob.type === "image/svg+xml") return blob;
  try {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext("2d")!.drawImage(bmp, 0, 0);
    const out = await new Promise<Blob | null>((r) => c.toBlob(r, "image/webp", 0.85));
    return out && out.type === "image/webp" && out.size < blob.size ? out : blob;
  } catch {
    return blob;
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** An AI image for one slide, saved on the phone. */
export async function imageSlide(id: string, i: number, force = false): Promise<void> {
  const st = await db.stories.get(id);
  const slide = st?.slides[i];
  if (!st || !slide || (slide.imageId && !force)) return void (slide && patchSlide(id, i, { picture: "image" }));
  await patchSlide(id, i, { picture: "image", pictureStatus: "running", pictureError: undefined });
  try {
    await loadMediaModels();
    const setup = imageSetup();
    if (!setup.model) throw new Error("Choose an image model in Settings › Story.");
    await loadEndpoints(setup.model);
    const { model, controls, values, maxRefs } = imageSetup(setup.model);
    const body: Record<string, unknown> = { model, prompt: scenePrompt(slide, st.style), ...requestParams(controls, values) };
    const refs = cfg().useRefs ? cfg().refImages.slice(0, maxRefs) : [];
    let made: { blob: Blob; cost?: number };
    try {
      made = await generateImage(key(), refs.length ? { ...body, input_references: refs.map((url) => ({ type: "image_url", image_url: { url } })) } : body);
    } catch (e) {
      if (!refs.length || !(e instanceof OpenRouterError) || e.status !== 400) throw e;
      made = await generateImage(key(), body); // the references were refused: try without them
    }
    const blob = await compact(made.blob);
    const mediaId = uid();
    await db.media.put({ id: mediaId, sessionId: st.sessionId, storyId: id, kind: "image", mime: blob.type, size: blob.size, label: `${st.title || "Story"} · image ${i + 1}`, blob, createdAt: Date.now() });
    if (slide.imageId) await db.media.delete(slide.imageId);
    await patchSlide(id, i, { imageId: mediaId, pictureStatus: "done", pictureCost: made.cost });
  } catch (e) {
    await patchSlide(id, i, { pictureStatus: "error", pictureError: message(e) });
  }
}

/** Start an AI video for one slide (the caller confirms the price first). */
export async function videoSlide(id: string, i: number): Promise<void> {
  const st = await db.stories.get(id);
  const slide = st?.slides[i];
  if (!st || !slide) return;
  await patchSlide(id, i, { picture: "video", pictureStatus: "running", pictureError: undefined });
  try {
    await loadMediaModels();
    const { model, controls, values } = videoSetup();
    if (!model) throw new Error("Choose a video model in Settings › Story.");
    // the narration plays over the clip, so its own sound is only asked for when wanted (it defaults to on)
    const body = { model, prompt: `${scenePrompt(slide, st.style)} Gentle camera movement.`, ...requestParams(controls, values), generate_audio: cfg().videoSound };
    let job: VideoJob;
    try {
      try {
        job = await submitVideo(key(), body);
      } catch (e) {
        if (!(e instanceof OpenRouterError) || e.status !== 400 || !/generate_audio|audio/i.test(e.message)) throw e;
        const { generate_audio: _drop, ...rest } = body;
        job = await submitVideo(key(), rest); // a model without sound settings
      }
    } catch (e) {
      const fix = e instanceof OpenRouterError && e.status === 400 ? supportedFromError(e.message) : undefined;
      if (fix) {
        const v = fix.values.map((x) => (isNaN(Number(x)) ? x : Number(x)))[0];
        updateSettings((s) => ({ story: { ...s.story, videoParams: { ...s.story.videoParams, [fix.key]: v } } }));
        throw new Error(`${e instanceof Error ? e.message : e} The ${fix.key} setting was changed to ${v}; try again.`);
      }
      throw e;
    }
    await patchSlide(id, i, { videoJob: { id: job.id, model, status: job.status ?? "pending", startedAt: Date.now() } });
    void pollVideo(id, i);
  } catch (e) {
    await patchSlide(id, i, { pictureStatus: "error", pictureError: message(e) });
  }
}

/** OpenRouter suggests polling about every 30 seconds; a clip usually takes from 30 seconds to a few minutes. */
export const VIDEO_POLL_MS = 30_000;
const polling = new Set<string>();

/** Poll a video job until it finishes, then save the clip. Resumes after a restart. */
export async function pollVideo(id: string, i: number): Promise<void> {
  const k = `${id}:${i}`;
  if (polling.has(k)) return;
  polling.add(k);
  try {
    for (;;) {
      const slide = (await db.stories.get(id))?.slides[i];
      const job = slide?.videoJob;
      if (!slide || !job) return;
      let res: VideoJob;
      try {
        res = await getVideo(key(), job.id);
      } catch (e) {
        if (e instanceof OpenRouterError && (e.status === 404 || e.status === 401)) throw e;
        await new Promise((r) => setTimeout(r, VIDEO_POLL_MS)); // offline or a hiccup: keep the job
        continue;
      }
      const phase = videoPhase(res.status);
      if (phase === "wait") {
        if (res.status !== job.status) await patchSlide(id, i, { videoJob: { ...job, status: res.status } });
        await new Promise((r) => setTimeout(r, VIDEO_POLL_MS));
        continue;
      }
      if (phase === "failed") {
        const why = typeof res.error === "string" ? res.error : res.error?.message;
        await patchSlide(id, i, { videoJob: undefined, pictureStatus: "error", pictureError: `The video ${res.status}${why ? `: ${why}` : ""}.` });
        return;
      }
      const url = res.unsigned_urls?.[0];
      if (!url) throw new Error("The video finished but no download link came back.");
      await saveClip(id, i, url, res.usage?.cost);
      return;
    }
  } catch (e) {
    await patchSlide(id, i, { videoJob: undefined, pictureStatus: "error", pictureError: message(e) });
  } finally {
    polling.delete(k);
  }
}

/**
 * Download the finished clip with the API key (the links aren't presigned) and save it on the phone. If the
 * download fails the job is kept, so the next start (or Regenerate) tries the download again.
 */
async function saveClip(id: string, i: number, url: string, cost?: number) {
  const st = (await db.stories.get(id))!;
  const slide = st.slides[i];
  let blob: Blob | undefined;
  let why = "";
  for (let attempt = 0; attempt < 3 && !blob; attempt++) {
    try {
      blob = await downloadVideo(key(), url);
    } catch (e) {
      why = message(e);
      if (attempt < 2) await new Promise((r) => setTimeout(r, 4000));
    }
  }
  if (!blob) {
    await patchSlide(id, i, { videoJob: slide.videoJob && { ...slide.videoJob, status: "completed" }, pictureStatus: "error", pictureError: `The video is ready but couldn't be downloaded (${why}).` });
    return;
  }
  const mediaId = uid();
  await db.media.put({ id: mediaId, sessionId: st.sessionId, storyId: id, kind: "video", mime: blob.type || "video/mp4", size: blob.size, label: `${st.title || "Story"} · video ${i + 1}`, blob, createdAt: Date.now() });
  if (slide.videoId) await db.media.delete(slide.videoId);
  await patchSlide(id, i, { videoId: mediaId, videoUrl: undefined, videoJob: undefined, pictureStatus: "done", pictureCost: cost });
}

export async function resumeVideos(): Promise<void> {
  for (const st of await db.stories.toArray()) st.slides.forEach((s, i) => s.videoJob && void pollVideo(st.id, i));
}
