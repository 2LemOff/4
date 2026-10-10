import { expect, test, type Page } from "@playwright/test";
import { mockOpenRouter, OCR_TEXT } from "./mock";
import { connect, selectWords } from "./helpers";

/** A small screenshot-like PNG drawn in the page. */
async function pngFile(page: Page, name = "screenshot.png", w = 240, h = 160) {
  const b64 = await page.evaluate(
    ([w, h]) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const g = c.getContext("2d")!;
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#3366cc";
      g.fillRect(20, 20, w / 2, h / 2);
      return c.toDataURL("image/png").split(",")[1];
    },
    [w, h],
  );
  return { name, mimeType: "image/png", buffer: Buffer.from(b64, "base64") };
}

async function pickPhoto(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  await page.getByRole("button", { name: "Add a picture" }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("dialog", { name: "Add a picture" }).getByText("Photos and screenshots").click();
  await (await chooser).setFiles(file);
}

const parts = (m: any): any[] => (Array.isArray(m.content) ? m.content : []);
const images = (m: any) => parts(m).filter((p) => p.type === "image_url");
const textOf = (m: any) => (typeof m.content === "string" ? m.content : parts(m).find((p) => p.type === "text")?.text ?? "");

test.describe("photos and screenshots", () => {
  test("attach a screenshot, ask about a part of it, then highlight the text read from it and ask again", async ({ page }) => {
    const calls = await mockOpenRouter(page);
    await connect(page);
    await pickPhoto(page, await pngFile(page));
    const row = page.getByRole("group", { name: "Pictures to send" });
    await expect(row.getByRole("img", { name: "Picture 1" })).toBeVisible();

    // a box over one part: it is sent along with the whole picture
    await row.getByRole("button", { name: "Ask about a part of Picture 1" }).click();
    const region = page.getByRole("dialog", { name: "Ask about a part" });
    const pic = (await region.locator(".region img").boundingBox())!;
    await page.mouse.move(pic.x + pic.width * 0.1, pic.y + pic.height * 0.1);
    await page.mouse.down();
    await page.mouse.move(pic.x + pic.width * 0.6, pic.y + pic.height * 0.7, { steps: 6 });
    await page.mouse.up();
    await region.getByRole("button", { name: "Use this part" }).click();
    await expect(row.getByRole("img", { name: "Part of picture 1" })).toBeVisible();
    await expect(row.getByRole("button", { name: "Remove Part of picture 1" })).toBeVisible();

    await page.getByLabel("What do you want to understand?").fill("What does this say?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page).toHaveURL(/#\/s\/\w+\?focus=\w+/);
    await expect(page.locator(".msg-ai .answer-text").last()).toContainText("Premise three concludes.");

    // the question went out with both pictures, as image parts of its own turn
    const first = calls.stream[0];
    expect(first.model).toBe("google/gemini-3.5-pro");
    const turn = first.messages[1];
    expect(images(turn)).toHaveLength(2);
    for (const p of images(turn)) expect(p.image_url.url).toMatch(/^data:image\/(webp|jpeg);base64,/);
    expect(textOf(turn)).toBe("What does this say?\n\n[Image 2 is a close-up of a part of image 1.]");

    // the chat shows the pictures; their text can be read, then highlighted like an answer
    const user = page.locator(".msg-user").first();
    await expect(user.locator(".msg-thumb")).toHaveCount(2);
    await user.getByRole("button", { name: "Read the text in them" }).click();
    await expect(page.locator(".img-text")).toHaveCount(2);
    await expect(page.locator(".img-text").first()).toContainText("the force grows with the stretch");
    const ocr = calls.json.filter((b) => textOf(b.messages[0]).startsWith("Copy all the text in the image"));
    expect(ocr).toHaveLength(2);
    expect(images(ocr[0].messages[0])).toHaveLength(1);

    await selectWords(page, 0, "the force grows");
    await page.getByRole("toolbar", { name: "Selected text" }).getByRole("button", { name: "Mark+" }).click();
    await expect(page.locator(".img-text mark.hl")).toHaveText("the force grows");
    await expect(page.locator(".tray-chip")).toHaveCount(1);

    const before = calls.stream.length;
    await page.locator(".composer textarea").fill("Why does it grow?");
    await page.locator(".composer").getByRole("button", { name: "Ask", exact: true }).click();
    await expect.poll(() => calls.stream.length).toBe(before + 1);
    const second = calls.stream[before];
    // the earlier turn is replayed exactly, pictures included; the new turn quotes the highlighted words
    expect(second.messages[1]).toEqual(turn);
    expect(textOf(second.messages.at(-1))).toBe('About this part of the text in my picture: "the force grows"\n\nMy question: Why does it grow?');
    await expect(page.locator(".msg-user")).toHaveCount(2);
    await expect(page.locator(".img-text mark.hl")).toHaveAttribute("data-n", "↳ 1");

    // compact but tappable, and nothing wider than the screen
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    const small = await page.$$eval("button.btn, .msg-thumb, .img-text summary", (els) =>
      els.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 27.5 || r.width < 27.5); }).map((e) => e.outerHTML.slice(0, 80)),
    );
    expect(small).toEqual([]);
  });

  test("a model that can't see pictures is switched; council members that can't see get the text read from them", async ({ page }) => {
    const calls = await mockOpenRouter(page);
    await connect(page);

    // a text-only model is chosen, then a picture is pasted: a model that can see it is used
    await page.getByRole("button", { name: "Model settings" }).click();
    const sheet = page.getByRole("dialog", { name: "Model settings" });
    await sheet.getByRole("button", { name: /Model for this question/ }).click();
    await page.getByLabel("Search models").fill("grok");
    await page.getByRole("button", { name: /grok/i }).first().click();
    await sheet.getByRole("button", { name: "Done" }).click();
    const png = await pngFile(page);
    const paste = () =>
      page.evaluate((b64) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const dt = new DataTransfer();
        dt.items.add(new File([bytes], "pasted.png", { type: "image/png" }));
        document.querySelector("textarea")!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      }, png.buffer.toString("base64"));
    const note = page.getByRole("status").filter({ hasText: "which can see pictures" });
    await paste();
    await expect(page.getByRole("group", { name: "Pictures to send" }).getByRole("img", { name: "Picture 1" })).toBeVisible();
    await expect(note).toContainText("Using gemini-3.5-pro");
    // removing the picture goes back to the chosen model (so a new picture switches again)
    await page.getByRole("button", { name: "Remove Picture 1" }).click();
    await expect(note).toHaveCount(0);
    await paste();
    await expect(note).toContainText("Using gemini-3.5-pro");

    // with the council on, every member answers; grok gets the text read from the picture instead
    await page.getByRole("button", { name: "Council", exact: true }).click();
    await expect(page.getByText("Council members that can't see pictures get the text read from them.")).toBeVisible();
    await page.getByLabel("What do you want to understand?").fill("Explain the law in this screenshot");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page).toHaveURL(/#\/s\//);
    await expect.poll(() => calls.stream.filter((b) => !JSON.stringify(b.messages).includes("COUNCIL RESPONSES")).length).toBe(4);
    const members = calls.stream.filter((b) => !JSON.stringify(b.messages).includes("COUNCIL RESPONSES"));
    const grok = members.find((b) => b.model === "x-ai/grok-4.5")!;
    expect(images(grok.messages[1])).toHaveLength(0);
    expect(textOf(grok.messages[1])).toBe(`Explain the law in this screenshot\n\n[Attached image 1: the text in it reads: "${OCR_TEXT}"]`);
    for (const b of members.filter((x) => x.model !== "x-ai/grok-4.5")) expect(images(b.messages[1])).toHaveLength(1);
    // the chairman sees the picture too
    await expect.poll(() => calls.stream.some((b) => JSON.stringify(b.messages).includes("COUNCIL RESPONSES"))).toBe(true);
    const chair = calls.stream.find((b) => JSON.stringify(b.messages).includes("COUNCIL RESPONSES"))!;
    expect(images(chair.messages.at(-1))).toHaveLength(1);
    // the text read for grok is shown under the question and can be highlighted
    await expect(page.locator(".img-text")).toContainText("The spring constant sets the slope.");
  });
});
