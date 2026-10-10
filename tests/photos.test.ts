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
