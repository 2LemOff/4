import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { db } from "./db";
import type { AppSettings } from "./store";
import type { MediaRecord } from "./types";

const EXT: Record<string, string> = { "audio/mpeg": "mp3", "audio/wav": "wav", "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg", "video/mp4": "mp4", "video/webm": "webm", "image/svg+xml": "svg" };

export interface BackupData {
  app: "fractal";
  version: 2;
  exportedAt: number;
  sessions: unknown[];
  cards: unknown[];
  outlines: unknown[];
  bookmarks: unknown[];
  stories: unknown[];
  /** chat highlights (backups made before v3 have none) */
  highlights?: unknown[];
  media: Omit<MediaRecord, "blob">[];
  settings?: Omit<AppSettings, "apiKey">;
}

/** One zip with data.json and every media file. The API key is never included. */
export async function buildBackup(opts: { includeVideos: boolean; settings?: AppSettings }): Promise<Uint8Array> {
  const media = (await db.media.toArray()).filter((m) => opts.includeVideos || m.kind !== "video");
  const settings = opts.settings ? (({ apiKey: _k, ...rest }) => rest)(opts.settings) : undefined;
  const data: BackupData = {
    app: "fractal",
    version: 2,
    exportedAt: Date.now(),
    sessions: await db.sessions.toArray(),
    cards: await db.cards.toArray(),
    outlines: await db.outlines.toArray(),
    bookmarks: await db.bookmarks.toArray(),
    stories: await db.stories.toArray(),
    highlights: await db.highlights.toArray(),
    media: media.map(({ blob: _b, ...meta }) => meta),
    settings,
  };
  const files: Zippable = { "data.json": [strToU8(JSON.stringify(data)), { level: 6 }] };
  for (const m of media) files[`media/${m.id}.${EXT[m.mime] ?? "bin"}`] = [new Uint8Array(await m.blob.arrayBuffer()), { level: 0 }];
  return zipSync(files);
}

export const backupName = (d = new Date()) => `fractal-backup-${d.toISOString().slice(0, 10)}.zip`;

/** Open Android's share sheet (save to Drive, Files…), or download when sharing files isn't available. */
export async function shareOrDownload(zip: Uint8Array, name = backupName()): Promise<"shared" | "downloaded"> {
  const file = new File([zip.slice().buffer], name, { type: "application/zip" });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: "Fractal backup" });
    return "shared";
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return "downloaded";
}

/** Restore a backup zip (or a v1 JSON export). Merges by id. Returns counts and any saved settings. */
export async function restoreBackup(bytes: Uint8Array): Promise<{ sessions: number; media: number; settings?: BackupData["settings"] }> {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  let data: Partial<BackupData> & { app?: string };
  let files: Record<string, Uint8Array> = {};
  if (isZip) {
    files = unzipSync(bytes);
    if (!files["data.json"]) throw new Error("This zip is not a Fractal backup.");
    data = JSON.parse(strFromU8(files["data.json"]));
  } else {
    data = JSON.parse(strFromU8(bytes));
  }
  if (data.app !== "fractal") throw new Error("This file is not a Fractal backup.");
  await db.sessions.bulkPut((data.sessions ?? []) as never[]);
  await db.cards.bulkPut((data.cards ?? []) as never[]);
  await db.outlines.bulkPut((data.outlines ?? []) as never[]);
  await db.bookmarks.bulkPut((data.bookmarks ?? []) as never[]);
  await db.stories.bulkPut((data.stories ?? []) as never[]);
  await db.highlights.bulkPut((data.highlights ?? []) as never[]);
  let mediaCount = 0;
  for (const meta of data.media ?? []) {
    const path = Object.keys(files).find((p) => p.startsWith(`media/${meta.id}.`));
    if (!path) continue;
    await db.media.put({ ...meta, blob: new Blob([files[path].slice().buffer], { type: meta.mime }) });
    mediaCount++;
  }
  return { sessions: data.sessions?.length ?? 0, media: mediaCount, settings: data.settings };
}
