import { db } from "./db";
import { familyModels, PICKER_FAMILIES } from "./models";
import { describeImages } from "./openrouter";
import { modelInfo, modelsStore, settingsStore } from "./store";
import { taskSetup } from "./taskConfig";
import type { BuildOptions } from "./tree";
import type { Card, CardImage, ModelInfo } from "./types";

/** Can this model look at pictures? */
export const seesImages = (m: ModelInfo) => !!m.architecture?.input_modalities?.includes("image");

/**
 * A model that can see the attached pictures: the chosen one if it can, else the newest of its family that
 * can, else the newest that can at all.
 */
export function visionModelFor(current: string): string | undefined {
  if (seesImages(modelInfo(current))) return current;
  const models = modelsStore.get().models;
  const fam = PICKER_FAMILIES.find((f) => familyModels(models, f.id, 50).some((m) => m.id === current));
  const sameFamily = fam ? familyModels(models.filter(seesImages), fam.id, 1)[0] : undefined;
  if (sameFamily) return sameFamily.id;
  for (const f of ["gemini-pro", "claude-opus", "openai", "gemini-flash"] as const) {
    const m = familyModels(models.filter(seesImages), f, 1)[0];
    if (m) return m.id;
  }
  return models.filter(seesImages).sort((a, b) => (b.created ?? 0) - (a.created ?? 0))[0]?.id;
}

/** Shrink a photo or screenshot to at most `max` px on its long side, saved as WebP (JPEG where WebP isn't possible). */
export async function shrinkImage(file: Blob, max = 1600): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * k));
  c.height = Math.max(1, Math.round(bmp.height * k));
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  const webp = await new Promise<Blob | null>((r) => c.toBlob(r, "image/webp", 0.85));
  if (webp && webp.type === "image/webp") return webp;
  return (await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.85))) ?? file;
}

/** A part of a picture, given as fractions (0–1) of its width and height. */
export async function cropImage(file: Blob, box: { x: number; y: number; w: number; h: number }): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const sx = Math.round(box.x * bmp.width);
  const sy = Math.round(box.y * bmp.height);
  const sw = Math.max(1, Math.round(box.w * bmp.width));
  const sh = Math.max(1, Math.round(box.h * bmp.height));
  const c = document.createElement("canvas");
  c.width = sw;
  c.height = sh;
  c.getContext("2d")!.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
  return (await new Promise<Blob | null>((r) => c.toBlob(r, "image/webp", 0.9))) ?? file;
}

export async function blobToDataUrl(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${b.type || "application/octet-stream"};base64,${btoa(bin)}`;
}

/** Data URLs of the pictures attached to these cards (missing files are skipped). */
export async function imageUrls(cards: Card[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const c of cards) {
    if (!c.images?.length) continue;
    const urls: string[] = [];
    for (const im of c.images) {
      const rec = await db.media.get(im.mediaId);
      if (rec) urls.push(await blobToDataUrl(rec.blob));
    }
    if (urls.length) out.set(c.id, urls);
  }
  return out;
}

/** For a model that sees the pictures: which one is a close-up of which (nothing when none is). */
export function imageCaption(c: Card): string | undefined {
  const parts = (c.images ?? []).flatMap((im, i) => (im.partOf !== undefined ? [`Image ${i + 1} is a close-up of a part of image ${im.partOf + 1}.`] : []));
  return parts.length ? `[${parts.join(" ")}]` : undefined;
}

/** What a model that can't see pictures gets instead: the text found in them. */
export function imageNote(c: Card): string | undefined {
  if (!c.images?.length) return undefined;
  return c.images
    .map((im, i) => `[Attached image ${i + 1}${im.partOf !== undefined ? ` (a part of image ${im.partOf + 1})` : ""}: ${im.text ? `the text in it reads: "${im.text}"` : "its text wasn't read"}]`)
    .join("\n");
}

async function patchImage(cardId: string, i: number, patch: Partial<CardImage>) {
  await db.transaction("rw", db.cards, async () => {
    const c = await db.cards.get(cardId);
    if (!c?.images?.[i]) return;
    c.images[i] = { ...c.images[i], ...patch };
    await db.cards.put(c);
  });
}

/** Read the text in one attached picture (the Text from images task); the text can then be highlighted. */
export async function readImageText(cardId: string, i: number): Promise<void> {
  const c = await db.cards.get(cardId);
  const im = c?.images?.[i];
  if (!c || !im) return;
  await patchImage(cardId, i, { textStatus: "running", textError: undefined });
  try {
    const key = settingsStore.get().apiKey;
    if (!key) throw new Error("Connect OpenRouter in Settings first.");
    const rec = await db.media.get(im.mediaId);
    if (!rec) throw new Error("This picture was deleted.");
    const t = taskSetup("ocr");
    const text = (await describeImages(key, t.model, t.prompt, [await blobToDataUrl(rec.blob)], t.params)).trim();
    await patchImage(cardId, i, { text: text || "(no text found)", textStatus: "done" });
  } catch (e) {
    await patchImage(cardId, i, { textStatus: "error", textError: e instanceof Error ? e.message : String(e) });
  }
}

/** The cards again, after reading the text of every attached picture that hasn't been read yet. */
export async function withImageText(cards: Card[]): Promise<Card[]> {
  const reload = (list: Card[]) => Promise.all(list.map(async (c) => (c.images?.length ? ((await db.cards.get(c.id)) ?? c) : c)));
  const now = await reload(cards);
  const todo = now.flatMap((c) => (c.images ?? []).flatMap((im, i) => (im.text ? [] : [{ id: c.id, i }])));
  if (!todo.length) return now;
  await Promise.all(todo.map((t) => readImageText(t.id, t.i)));
  return reload(now);
}

export type ImageOptions = Pick<BuildOptions, "images" | "newImages" | "imageText" | "newImageText">;

/**
 * How the pictures attached along a branch are replayed for one model: the pictures themselves, each in the
 * turn it was sent with, for a model that can see them; else the text read from them (read first if needed).
 */
export async function imageOptions(model: string, path: Card[], card?: Card): Promise<ImageOptions> {
  const all = card ? [...path, card] : path;
  if (!all.some((c) => c.images?.length)) return {};
  if (seesImages(modelInfo(model))) {
    const urls = await imageUrls(all);
    const byId = new Map(all.map((c) => [c.id, c]));
    const caption = (id: string) => {
      const c = byId.get(id);
      return c && imageCaption(c);
    };
    return { images: (id) => urls.get(id), newImages: card && urls.get(card.id), imageText: caption, newImageText: card && caption(card.id) };
  }
  const byId = new Map((await withImageText(all)).map((c) => [c.id, c]));
  const note = (id: string) => {
    const c = byId.get(id);
    return c && imageNote(c);
  };
  return { imageText: note, newImageText: card && note(card.id) };
}
