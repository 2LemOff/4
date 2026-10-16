import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/db";
import { deleteBranch } from "../src/ai";
import { blobToDataUrl, imageCaption, imageNote, imageOptions } from "../src/photos";
import { modelsStore } from "../src/store";
import { buildMessages, indexCards } from "../src/tree";
import { attachedLabels } from "../src/components/Attachments";
import { card, gemini, grok } from "./fixtures";

const sees = { ...gemini, architecture: { input_modalities: ["text", "image"] } };
const blind = { ...grok, architecture: { input_modalities: ["text"] } };
const picture = (bytes: number[]) => new Blob([new Uint8Array(bytes)], { type: "image/webp" });

// a screenshot with a close-up of one part of it, read already; then a follow-up without pictures
const root = card({
  id: "r",
  question: "What does this say?",
  images: [
    { mediaId: "m1", label: "Picture 1", text: "Hooke's law" },
    { mediaId: "m2", label: "Part of picture 1", partOf: 0, text: "F = kx" },
  ],
  assistant: { content: "It states Hooke's law." },
});
const next = card({ id: "n", parentId: "r", question: "Why linear?" });

beforeEach(async () => {
  await db.delete();
  await db.open();
  modelsStore.set({ ...modelsStore.get(), models: [sees, blind] });
  await db.media.bulkPut([
    { id: "m1", sessionId: "s1", kind: "image", mime: "image/webp", size: 3, label: "p1", blob: picture([1, 2, 3]), createdAt: 1 },
    { id: "m2", sessionId: "s1", kind: "image", mime: "image/webp", size: 2, label: "p2", blob: picture([4, 5]), createdAt: 1 },
  ]);
  await db.cards.bulkPut([root, next]);
});

describe("pictures in questions", () => {
  it("encodes a picture as a data URL", async () => {
    expect(await blobToDataUrl(picture([1, 2, 3]))).toBe("data:image/webp;base64,AQID");
  });

  it("tells a model that can't see pictures what they say", () => {
    expect(imageNote(root)).toBe('[Attached image 1: the text in it reads: "Hooke\'s law"]\n[Attached image 2 (a part of image 1): the text in it reads: "F = kx"]');
    expect(imageNote({ ...root, images: [{ mediaId: "m1", label: "Picture 1" }] })).toBe("[Attached image 1: its text wasn't read]");
    expect(imageNote(next)).toBeUndefined();
  });

  it("says which picture is a close-up of which", () => {
    expect(imageCaption(root)).toBe("[Image 2 is a close-up of a part of image 1.]");
    expect(imageCaption({ ...root, images: [{ mediaId: "m1", label: "Picture 1" }] })).toBeUndefined();
  });

  it("replays the pictures in the turn they were sent with, for a model that sees them", async () => {
    const idx = indexCards([root]);
    const pics = await imageOptions(sees.id, [root], next);
    const msgs = buildMessages(idx, "r", next.question, undefined, { systemPrompt: "SYS", model: sees.id, ...pics });
    expect(msgs.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(msgs[1].images).toEqual(["data:image/webp;base64,AQID", "data:image/webp;base64,BAU="]);
    expect(msgs[1].content).toBe("What does this say?\n\n[Image 2 is a close-up of a part of image 1.]");
    expect(msgs[3]).toEqual({ role: "user", content: "Why linear?" });
  });

  it("keeps the first turn exactly as it was first sent (append-only)", async () => {
    const first = buildMessages(indexCards([]), null, root.question, undefined, { systemPrompt: "SYS", model: sees.id, ...(await imageOptions(sees.id, [], root)) });
    const later = buildMessages(indexCards([root]), "r", next.question, undefined, { systemPrompt: "SYS", model: sees.id, ...(await imageOptions(sees.id, [root], next)) });
    expect(later.slice(0, 2)).toEqual(first);
  });

  it("sends the text read from them instead to a model that can't see them", async () => {
    const pics = await imageOptions(blind.id, [root], next);
    const msgs = buildMessages(indexCards([root]), "r", next.question, undefined, { systemPrompt: "SYS", model: blind.id, ...pics });
    expect(msgs[1].images).toBeUndefined();
    expect(msgs[1].content).toBe(`What does this say?\n\n${imageNote(root)}`);
    expect(msgs[3]).toEqual({ role: "user", content: "Why linear?" });
  });

  it("adds nothing when no question had pictures", async () => {
    expect(await imageOptions(sees.id, [next])).toEqual({});
  });

  it("deletes a question's pictures with its branch", async () => {
    await db.sessions.put({ id: "s1", title: "T", rootCardId: "r", lastCardId: "n", systemPrompt: "SYS", answerModel: sees.id, createdAt: 1, updatedAt: 1 });
    await deleteBranch("r");
    expect(await db.media.count()).toBe(0);
  });
});

describe("pictures to send", () => {
  it("are numbered, and a part names its picture", () => {
    const list = [
      { key: "a", blob: picture([1]), url: "" },
      { key: "b", blob: picture([2]), url: "" },
      { key: "c", blob: picture([3]), url: "", partOf: "b" },
    ];
    expect([...attachedLabels(list).values()]).toEqual(["Picture 1", "Picture 2", "Part of picture 2"]);
  });
});

describe("videos in questions", () => {
  const watches = { ...gemini, id: "google/gemini-4-argon", architecture: { input_modalities: ["text", "image", "video"] }, pricing: { prompt: "0.000002" } };
  const vcard = card({
    id: "v",
    question: "What happens here?",
    videos: [{ mediaId: "vid1", label: "Video 1", seconds: 3, frames: ["f1", "f2"] }, { link: "https://youtu.be/abc", label: "Video 2", frames: [] }],
    assistant: { content: "A spring bounces." },
  });
  beforeEach(async () => {
    modelsStore.set({ ...modelsStore.get(), models: [sees, blind, watches] });
    await db.media.bulkPut([
      { id: "vid1", sessionId: "s1", kind: "video", mime: "video/webm", size: 3, label: "v", blob: new Blob([new Uint8Array([7, 7, 7])], { type: "video/webm" }), createdAt: 1 },
      { id: "f1", sessionId: "s1", kind: "image", mime: "image/webp", size: 1, label: "f1", blob: picture([1]), createdAt: 1 },
      { id: "f2", sessionId: "s1", kind: "image", mime: "image/webp", size: 1, label: "f2", blob: picture([2]), createdAt: 1 },
    ]);
  });

  it("a model that watches videos gets the clip (and links) in the turn they were sent with", async () => {
    const msgs = buildMessages(indexCards([]), null, vcard.question, undefined, { systemPrompt: "SYS", model: watches.id, ...(await imageOptions(watches.id, [], vcard)) });
    expect(msgs[1].videos).toEqual(["data:video/webm;base64,BwcH", "https://youtu.be/abc"]);
    expect(msgs[1].images).toBeUndefined();
    expect(msgs[1].content).toBe("What happens here?");
  });

  it("a model that only sees pictures gets the still frames, with a note", async () => {
    const msgs = buildMessages(indexCards([]), null, vcard.question, undefined, { systemPrompt: "SYS", model: sees.id, ...(await imageOptions(sees.id, [], vcard)) });
    expect(msgs[1].videos).toBeUndefined();
    expect(msgs[1].images).toEqual(["data:image/webp;base64,AQ==", "data:image/webp;base64,Ag=="]);
    expect(msgs[1].content).toBe("What happens here?\n\n[Video 1 (3 s) is shown as 2 still frames, in order, after any pictures.]\n[Attached video 2: https://youtu.be/abc. This model can't watch videos.]");
  });

  it("a model that sees neither gets a note, and the turn replays the same way later", async () => {
    const pics = await imageOptions(blind.id, [], vcard);
    const first = buildMessages(indexCards([]), null, vcard.question, undefined, { systemPrompt: "SYS", model: blind.id, ...pics });
    expect(first[1].content).toContain("[Attached video 1 (3 s). This model can't watch videos.]");
    const later = buildMessages(indexCards([vcard]), "v", "And then?", undefined, { systemPrompt: "SYS", model: blind.id, ...(await imageOptions(blind.id, [vcard])) });
    expect(later[1]).toEqual(first[1]);
  });

  it("deletes a question's video and frames with its branch", async () => {
    await db.cards.put(vcard);
    await db.sessions.put({ id: "s1", title: "T", rootCardId: "v", lastCardId: "v", systemPrompt: "SYS", answerModel: watches.id, createdAt: 1, updatedAt: 1 });
    await deleteBranch("v");
    expect(await db.media.where("id").anyOf(["vid1", "f1", "f2"]).count()).toBe(0);
  });
});
