import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { mockOpenRouter } from "./mock";
import { connect } from "./helpers";

/** A 3-second 320×180 clip (VP8 + Opus, so the open-source Chromium can play it). */
const CLIP = fileURLToPath(new URL("./fixtures/clip.webm", import.meta.url));

async function pickVideo(page: Page) {
  await page.getByRole("button", { name: "Add a picture or video" }).first().click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("dialog", { name: "Add a picture or video" }).getByText("Videos", { exact: true }).click();
  await (await chooser).setFiles(CLIP);
}

const parts = (m: any): any[] => (Array.isArray(m.content) ? m.content : []);
const ofType = (m: any, type: string) => parts(m).filter((p) => p.type === type);
const textOf = (m: any) => (typeof m.content === "string" ? m.content : parts(m).find((p) => p.type === "text")?.text ?? "");

test.describe("videos in questions", () => {
  test("attach a video: its length and price show, a model that watches videos gets the clip, the chat plays it", async ({ page }) => {
    const calls = await mockOpenRouter(page);
    await connect(page);
    await pickVideo(page);
    const row = page.getByRole("group", { name: "Videos to send" });
    // 3 s × (70 + 32) tokens a second at Gemini 3.5 Pro's $2 per million input tokens
    await expect(row).toContainText("Video 1 · 0:03 · ≈ 307 tokens · ≈ $0.0006 with gemini-3.5-pro");
    await expect(row.getByRole("img", { name: "Video 1" })).toBeVisible();

    await page.getByLabel("What do you want to understand?").fill("What happens in this clip?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page).toHaveURL(/#\/s\/\w+\?focus=\w+/);
    await expect(page.locator(".msg-ai .answer-text").last()).toContainText("Premise three concludes.");

    // the whole clip goes out as a video part of its own turn
    const first = calls.stream[0];
    expect(first.model).toBe("google/gemini-3.5-pro");
    const turn = first.messages[1];
    expect(textOf(turn)).toBe("What happens in this clip?");
    expect(ofType(turn, "image_url")).toHaveLength(0);
    const [video] = ofType(turn, "video_url");
    expect(video.video_url.url).toMatch(/^data:video\/webm;base64,/);
    expect(Buffer.from(video.video_url.url.split(",")[1], "base64").equals(readFileSync(CLIP))).toBe(true);

    // the chat shows it under the question and plays it
    const user = page.locator(".msg-user").first();
    await expect(user.locator(".msg-thumb.video")).toContainText("0:03");
    await user.getByRole("button", { name: "Play video 1" }).click();
    const sheet = page.getByRole("dialog", { name: "Video 1" });
    await expect.poll(() => sheet.locator("video.video-full").evaluate((v: HTMLVideoElement) => v.duration)).toBeGreaterThan(2.9);
    await sheet.getByRole("button", { name: "Close" }).click();

    // a follow-up replays the earlier turn exactly, video included
    await page.locator(".composer textarea").fill("And then?");
    await page.locator(".composer").getByRole("button", { name: "Ask", exact: true }).click();
    await expect.poll(() => calls.stream.length).toBe(2);
    expect(calls.stream[1].messages[1]).toEqual(turn);
    expect(calls.stream[1].messages.at(-1)).toEqual({ role: "user", content: "And then?" });

    // compact but tappable, and nothing wider than the screen
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    const small = await page.$$eval("button.btn, .msg-thumb", (els) =>
      els.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 27.5 || r.width < 27.5); }).map((e) => e.outerHTML.slice(0, 80)),
    );
    expect(small).toEqual([]);
  });

  test("the picker shows what the video costs on each model; one that only sees pictures gets still frames; a link goes as a link", async ({ page }) => {
    const calls = await mockOpenRouter(page);
    await connect(page);
    await pickVideo(page);
    const row = page.getByRole("group", { name: "Videos to send" });
    await expect(row).toContainText("0:03");

    // pick a model that sees pictures but not video, by hand: it stays the choice
    await page.getByRole("button", { name: "Model settings" }).click();
    const settings = page.getByRole("dialog", { name: "Model settings" });
    await expect(settings).toContainText("Only models that can see videos or pictures (as still frames) are listed, with what your video costs on each.");
    await settings.getByRole("button", { name: /Model for this question/ }).click();
    await page.getByLabel("Search models").fill("claude-sonnet");
    const sonnet = page.getByRole("button", { name: /claude-sonnet-5\.5/ }).first();
    // 2 still frames (one every 2 s) × about 800 tokens at $2 per million
    await expect(sonnet).toContainText("your video: as still frames, ≈ 1.6k tokens · ≈ $0.0032");
    await sonnet.click();
    await settings.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("status").filter({ hasText: "can't watch videos" })).toHaveText("This model can't watch videos: still frames from them are sent instead.");
    await expect(row).toContainText("as still frames, ≈ 1.6k tokens · ≈ $0.0032 with claude-sonnet-5.5");

    await page.getByLabel("What do you want to understand?").fill("What happens?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page).toHaveURL(/#\/s\//);
    await expect.poll(() => calls.stream.length).toBe(1);
    const first = calls.stream[0];
    expect(first.model).toBe("anthropic/claude-sonnet-5.5");
    expect(ofType(first.messages[1], "video_url")).toHaveLength(0);
    const frames = ofType(first.messages[1], "image_url");
    expect(frames).toHaveLength(2);
    for (const f of frames) expect(f.image_url.url).toMatch(/^data:image\/(webp|png);base64,/);
    expect(textOf(first.messages[1])).toBe("What happens?\n\n[Video 1 (3 s) is shown as 2 still frames, in order, after any pictures.]");
    await expect(page.locator(".msg-ai .answer-text").last()).toContainText("Premise three concludes.");

    // a YouTube link: the follow-up moves to a model that watches videos, which gets the link as it is
    await page.locator(".composer").getByRole("button", { name: "Add a picture or video" }).click();
    const attach = page.getByRole("dialog", { name: "Add a picture or video" });
    await attach.getByLabel("Video link").fill("https://youtu.be/abc123");
    await attach.getByRole("button", { name: "Add link" }).click();
    const linkRow = page.getByRole("group", { name: "Videos to send" });
    await expect(linkRow).toContainText("Video 1 · youtu.be · billed by its length (shown after the answer) with gemini-3.5-pro");
    await expect(page.getByRole("status").filter({ hasText: "which can watch videos" })).toHaveText("Using gemini-3.5-pro, which can watch videos.");
    await page.locator(".composer textarea").fill("And in this one?");
    await page.locator(".composer").getByRole("button", { name: "Ask", exact: true }).click();
    await expect.poll(() => calls.stream.length).toBe(2);
    const second = calls.stream[1];
    expect(second.model).toBe("google/gemini-3.5-pro");
    // this model watches videos, so the first turn now carries the clip itself, and the new turn the link
    expect(ofType(second.messages[1], "video_url").map((p) => p.video_url.url.slice(0, 22))).toEqual(["data:video/webm;base64"]);
    const last = second.messages.at(-1);
    expect(textOf(last)).toBe("And in this one?");
    expect(ofType(last, "video_url").map((p) => p.video_url.url)).toEqual(["https://youtu.be/abc123"]);
  });
});
