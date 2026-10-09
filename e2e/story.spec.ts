import { expect, test } from "@playwright/test";
import { mockOpenRouter } from "./mock";
import { askRoot, connect, item } from "./helpers";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test.describe("Story slides", () => {
  test("on demand from the menu: ScienceClic style, drawn shapes, narration, speed and asking about a line", async ({ page }) => {
    const calls = await mockOpenRouter(page);
    await connect(page);
    await askRoot(page, "Why is the sky blue?");
    expect(calls.speech).toHaveLength(0);

    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("button", { name: /Learn as a story/ }).click();
    const sheet = page.getByRole("dialog", { name: "Learn as a story" });
    await sheet.getByRole("radio", { name: "ScienceClic" }).click();
    await sheet.getByRole("button", { name: "Make the story" }).click();
    await expect(page).toHaveURL(/#\/story\/\w+/);

    await expect(page.getByText("Grid and the blue sky")).toBeVisible();
    const pic = page.locator(".story-pic img");
    await expect(pic).toBeVisible();
    const src = decodeURIComponent((await pic.getAttribute("src"))!);
    expect(src).toMatch(/^data:image\/svg\+xml/);
    expect(src).toContain("<circle");
    expect(src).not.toContain("script");
    expect(src).not.toContain("onclick");

    const story = calls.json.find((b) => JSON.stringify(b.messages).includes("narrated storyboard"))!;
    const sys = JSON.stringify(story.messages[0]);
    expect(sys).toContain("ScienceClic");
    expect(sys).not.toContain("TED-Ed");
    expect(story.messages[1].content).toContain("Question: Why is the sky blue?");
    await expect.poll(() => calls.speech.length).toBe(4);
    expect(calls.speech[0]).toMatchObject({ model: "openai/gpt-4o-mini-tts", voice: "alloy", response_format: "mp3" });

    // playback speed changes the audio element and is remembered
    await page.getByRole("button", { name: "Playback speed" }).click();
    await expect(page.getByRole("button", { name: "Playback speed" })).toHaveText("1.25×");
    expect(await page.locator("audio").evaluate((a: HTMLAudioElement) => a.playbackRate)).toBe(1.25);

    await page.getByRole("button", { name: "Next slide" }).click();
    await expect(page.getByText(/Slide 2 of 4/)).toBeVisible();
    await page.getByRole("button", { name: "Grid looks up in scene 2." }).click();
    await expect(page).toHaveURL(/quote=/);
    await expect(page.locator(".dock")).toContainText("Grid looks up in scene 2.");
    await page.locator(".dock textarea").fill("Why?");
    const n = calls.stream.length;
    await page.locator(".dock").getByRole("button", { name: "Ask", exact: true }).click();
    await expect.poll(() => calls.stream.length).toBe(n + 1);
    expect(calls.stream[n].messages.at(-1).content).toContain('"Grid looks up in scene 2."\n\nMy question: Why?');
  });

  test("from a point: covers its pyramid in TED-Ed style; reopens from the list", async ({ page }) => {
    const calls = await mockOpenRouter(page);
    await connect(page);
    await askRoot(page, "Why is the sky blue?");
    await page.getByRole("button", { name: "Fit the whole map" }).click();
    await item(page, "K1.n6").click();
    await page.getByRole("region", { name: "Selected point" }).getByRole("button", { name: "Learn as a story" }).click();
    const sheet = page.getByRole("dialog", { name: "Learn as a story" });
    await expect(sheet.getByRole("radio", { name: /Pyramid “Observer view”/ })).toHaveAttribute("aria-checked", "true");
    await sheet.getByRole("button", { name: "Make the story" }).click();
    await expect(page.getByText("Mia and the blue sky")).toBeVisible();
    const story = calls.json.find((b) => JSON.stringify(b.messages).includes("narrated storyboard"))!;
    expect(JSON.stringify(story.messages[0])).toContain("TED-Ed");
    const material = story.messages[1].content as string;
    expect(material).toContain("An observer only sees light");
    expect(material).not.toContain("Air molecules scatter blue light");

    await page.getByRole("button", { name: "Back to the map" }).click();
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("button", { name: /Learn as a story/ }).click();
    await page.getByRole("dialog", { name: "Learn as a story" }).getByRole("button", { name: /Mia and the blue sky/ }).click();
    await expect(page).toHaveURL(/#\/story\//);
    await expect(page.locator(".story-pic img")).toBeVisible();
  });

  test("settings: screenshot style notes, voice preview, and a deleted narration can be regenerated", async ({ page }) => {
    const calls = await mockOpenRouter(page);
    await connect(page);
    await page.goto("/#/settings/story");
    await page.getByRole("radio", { name: /ScienceClic/ }).click();
    await page.getByLabel("Style screenshots").setInputFiles({ name: "frame.png", mimeType: "image/png", buffer: PNG });
    await expect(page.getByLabel("Style notes from screenshots")).toHaveValue(/teal and orange/);
    const vision = calls.json.find((b) => JSON.stringify(b).includes("Describe the visual style"))!;
    expect(vision.messages[0].content[1].image_url.url).toMatch(/^data:image\/jpeg/);

    await page.getByLabel("Voice", { exact: true }).fill("nova");
    await page.getByRole("button", { name: "▶ Preview voice" }).click();
    await expect.poll(() => calls.speech.length).toBe(1);
    expect(calls.speech[0].voice).toBe("nova");

    // the next story uses the notes; deleting a narration file leaves the text with Regenerate
    await page.goto("/#/");
    await askRoot(page, "Why is the sky blue?");
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("button", { name: /Learn as a story/ }).click();
    await page.getByRole("dialog", { name: "Learn as a story" }).getByRole("radio", { name: "ScienceClic" }).click();
    await page.getByRole("dialog", { name: "Learn as a story" }).getByRole("button", { name: "Make the story" }).click();
    await expect(page.locator(".story-pic img")).toBeVisible();
    const story = calls.json.find((b) => JSON.stringify(b.messages).includes("narrated storyboard"))!;
    expect(JSON.stringify(story.messages[0])).toContain("teal and orange");
    await expect.poll(() => calls.speech.length).toBe(5);
    const storyUrl = page.url();

    await page.goto("/#/settings/storage");
    page.on("dialog", (d) => d.accept());
    await page.getByLabel(/^Select .*narration 1$/).check();
    await page.getByRole("button", { name: /Delete selected/ }).click();
    await page.goto(storyUrl);
    await expect(page.getByRole("button", { name: "Regenerate narration" })).toBeVisible();
    await page.getByRole("button", { name: "Regenerate narration" }).click();
    await expect.poll(() => calls.speech.length).toBe(6);
    await expect(page.getByRole("button", { name: "Regenerate narration" })).toHaveCount(0);
  });
});
