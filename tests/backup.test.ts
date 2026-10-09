import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { db } from "../src/db";
import { buildBackup, restoreBackup } from "../src/backup";
import { deleteMedia, deleteTopics, formatBytes, usageBreakdown } from "../src/storage";
import { toggleBookmark } from "../src/bookmarks";
import { defaultAppSettings } from "../src/store";
import { card } from "./fixtures";

async function seed() {
  await db.sessions.put({ id: "s1", title: "Sky", rootCardId: "c1", lastCardId: "c1", systemPrompt: "SYS", answerModel: "m", createdAt: 1, updatedAt: 1 });
  await db.cards.put(card({ id: "c1", sessionId: "s1" }));
  await db.vectors.put({ cardId: "c1", blockIdx: 0, model: "e", vector: new Int8Array(512) });
  await db.stories.put({ id: "st1", sessionId: "s1", cardId: "c1", scope: "answer", title: "T", scenario: "", style: "ted-ed", status: "done", createdAt: 1,
    slides: [{ heading: "h", narration: "n", visual: "v", picture: "shapes", pictureStatus: "done", audioId: "a1", audioStatus: "done", videoId: "v1" }] });
  await db.media.bulkPut([
    { id: "a1", sessionId: "s1", storyId: "st1", kind: "audio", mime: "audio/mpeg", size: 3, label: "Narration 1", blob: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mpeg" }), createdAt: 1 },
    { id: "v1", sessionId: "s1", storyId: "st1", kind: "video", mime: "video/mp4", size: 5, label: "Video 1", blob: new Blob([new Uint8Array([9, 9, 9, 9, 9])], { type: "video/mp4" }), createdAt: 2 },
  ]);
  await toggleBookmark({ sessionId: "s1", cardId: "c1", nodeId: "K1.n1", label: "A point" });
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await seed();
});

describe("storage", () => {
  it("breaks usage down per topic and type", async () => {
    const { topics, files } = await usageBreakdown();
    expect(topics[0]).toMatchObject({ sessionId: "s1", audio: 3, video: 5, index: 552 });
    expect(topics[0].total).toBe(topics[0].text + 552 + 8);
    expect(files.map((f) => f.id)).toEqual(["v1", "a1"]);
  });
  it("deleting a file keeps the story text and marks it for regeneration", async () => {
    await deleteMedia(["a1"]);
    const st = await db.stories.get("st1");
    expect(st!.slides[0]).toMatchObject({ narration: "n", audioId: undefined, audioStatus: "pending" });
    expect(await db.media.get("a1")).toBeUndefined();
  });
  it("deletes whole topics", async () => {
    await deleteTopics(["s1"]);
    expect(await db.cards.count()).toBe(0);
    expect(await db.media.count()).toBe(0);
    expect(await db.vectors.count()).toBe(0);
    expect(await db.bookmarks.count()).toBe(0);
  });
  it("formats sizes", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });
  it("toggles bookmarks", async () => {
    expect(await toggleBookmark({ sessionId: "s1", cardId: "c1", nodeId: "K1.n1", label: "A point" })).toBe(false);
    expect(await db.bookmarks.count()).toBe(0);
  });
});

describe("backup", () => {
  it("round-trips everything and never includes the API key", async () => {
    const zip = await buildBackup({ includeVideos: true, settings: { ...defaultAppSettings(), apiKey: "sk-or-secret" } });
    const files = unzipSync(zip);
    expect(Object.keys(files).sort()).toEqual(["data.json", "media/a1.mp3", "media/v1.mp4"]);
    expect(strFromU8(files["data.json"])).not.toContain("sk-or-secret");
    await db.delete();
    await db.open();
    const r = await restoreBackup(zip);
    expect(r).toMatchObject({ sessions: 1, media: 2 });
    expect(r.settings && "apiKey" in r.settings).toBe(false);
    expect((await db.cards.get("c1"))?.question).toBe("Q c1");
    expect(await db.bookmarks.count()).toBe(1);
    const v = await db.media.get("v1");
    expect(new Uint8Array(await v!.blob.arrayBuffer())).toEqual(new Uint8Array([9, 9, 9, 9, 9]));
  });
  it("can leave videos out", async () => {
    const files = unzipSync(await buildBackup({ includeVideos: false }));
    expect(Object.keys(files).sort()).toEqual(["data.json", "media/a1.mp3"]);
  });
  it("restores v1 JSON exports and rejects other files", async () => {
    const v1 = new TextEncoder().encode(JSON.stringify({ app: "fractal", version: 1, sessions: [], cards: [card({ id: "old" })], outlines: [] }));
    await restoreBackup(v1);
    expect(await db.cards.get("old")).toBeDefined();
    await expect(restoreBackup(new TextEncoder().encode('{"x":1}'))).rejects.toThrow(/not a Fractal backup/);
  });
});

describe("migration", () => {
  it("v2 opens v1 data and converts float vectors to Int8", async () => {
    const Dexie = (await import("dexie")).default;
    await db.delete();
    const v1 = new Dexie("fractal");
    v1.version(1).stores({ sessions: "id,updatedAt", cards: "id,sessionId,parentId", outlines: "id,sessionId,category,createdAt", vectors: "[cardId+blockIdx],cardId", kv: "key" });
    await v1.open();
    await v1.table("cards").put(card({ id: "keep" }));
    await v1.table("vectors").put({ cardId: "keep", blockIdx: 0, model: "e", vector: new Float32Array([0.5, -1, 0.25]) });
    v1.close();
    await db.open();
    expect((await db.cards.get("keep"))?.id).toBe("keep");
    const vec = (await db.vectors.toArray())[0].vector;
    expect(vec).toBeInstanceOf(Int8Array);
    expect(Array.from(vec)).toEqual([64, -127, 32]);
  });
});
