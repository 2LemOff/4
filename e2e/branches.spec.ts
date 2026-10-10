import { expect, test, type Page } from "@playwright/test";
import { mockOpenRouter } from "./mock";
import { askDock, askRoot, connect, selectWords } from "./helpers";

const bar = (page: Page) => page.getByRole("toolbar", { name: "Selected text" });
const mark = (page: Page) => page.locator(".chat > .thread mark.hl").first();

/** Ask about words in the first answer; returns where the words were on screen before. */
async function askAbout(page: Page, words: string, question: string) {
  await selectWords(page, 0, words);
  const before = (await page.locator(".chat").evaluate((pane, w) => {
    const r = document.createRange();
    const walker = document.createTreeWalker(pane, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.nodeValue!.indexOf(w);
      if (i >= 0) {
        r.setStart(n, i);
        r.setEnd(n, i + w.length);
        const b = r.getBoundingClientRect();
        return { x: b.x, y: b.y };
      }
    }
    return null;
  }, words))!;
  await bar(page).getByRole("button", { name: "Ask" }).click();
  await askDock(page, question);
  return before;
}

test.describe("asking beside the original", () => {
  test("split: the words don't move; same-thread and new-branch follow-ups; a branch inside the branch; Back closes", async ({ page }) => {
    const calls = await mockOpenRouter(page);
    await connect(page);
    await askRoot(page, "Why is the sky blue?");
    const before = await askAbout(page, "depends on it", "Why does it depend?");
    await expect(page.locator(".branch-pane .answer-text")).toContainText("Premise three concludes.");
    const after = (await mark(page).boundingBox())!;
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(2);
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(2);
    await expect(mark(page)).toHaveAttribute("data-n", "①");
    // the branch knows the conversation: the whole chat up to that answer, then the quoted question
    expect(calls.stream[1].messages.slice(0, 3).map((m: any) => m.role)).toEqual(["system", "user", "assistant"]);

    // same thread: the follow-up continues the branch (it sees the first question)
    await expect(page.locator(".composer textarea")).toHaveAttribute("placeholder", "Ask in ①…");
    await askDock(page, "And then?");
    await expect.poll(() => calls.stream.length).toBe(3);
    expect(JSON.stringify(calls.stream[2].messages)).toContain("Why does it depend?");
    await expect(page.locator(".branch-pane .msg-user .bubble")).toHaveText(["Why does it depend?", "And then?"]);

    // new branch: only the original, the same quote and this question
    await page.getByRole("button", { name: "New branch" }).click();
    await askDock(page, "Is that always true?");
    await expect.poll(() => calls.stream.length).toBe(4);
    const nb = calls.stream[3].messages;
    expect(JSON.stringify(nb)).not.toContain("Why does it depend?");
    expect(nb.at(-1).content).toBe('About this part of your previous answer: "depends on it"\n\nMy question: Is that always true?');
    const tabs = page.getByRole("tablist", { name: "Branches" });
    await expect(tabs.getByRole("tab")).toHaveCount(2);
    await expect(tabs.getByRole("tab", { selected: true })).toContainText("②");
    await expect(mark(page)).toHaveAttribute("data-n", "① ②");

    // words in a branch's answer: a branch inside the branch, with its source above and ‹ Up
    await page.getByRole("button", { name: "Same thread" }).click();
    await tabs.getByRole("tab", { name: /①/ }).click();
    await expect(page.locator(".branch-pane .msg-user .bubble")).toHaveText(["Why does it depend?", "And then?"]);
    const branchAnswers = await page.locator("[data-answer]").count();
    await selectWords(page, branchAnswers - 1, "second sentence");
    await bar(page).getByRole("button", { name: "Ask" }).click();
    await askDock(page, "Deeper?");
    await expect.poll(() => calls.stream.length).toBe(5);
    await expect(page.locator(".host-crumbs")).toHaveText("Main › ① › 1.1");
    await expect(page.locator(".chat > .thread .msg-user .bubble")).toHaveText(["Why does it depend?", "And then?"]);
    await page.getByRole("button", { name: "Up to the branch it came from" }).click();
    await expect(page.locator(".chat > .thread .msg-user .bubble")).toHaveText(["Why is the sky blue?"]);
    await expect(page.locator(".branch-pane .msg-user .bubble")).toHaveText(["Why does it depend?", "And then?"]);

    // Android Back goes back step by step; the original is where it was
    await page.goBack();
    await expect(page.locator(".host-crumbs")).toHaveText("Main › ① › 1.1");
    await page.getByRole("button", { name: "Close the branch" }).click();
    await expect(page.locator(".branch-host")).toHaveCount(0);
    expect(Math.abs((await mark(page).boundingBox())!.y - before.y)).toBeLessThanOrEqual(2);
  });

  test("bubble moves and resizes on screen; layer drops to a bar and is see-through; landscape is side by side", async ({ page }) => {
    await mockOpenRouter(page);
    await connect(page);
    await askRoot(page, "Why is the sky blue?");
    await askAbout(page, "depends on it", "Why does it depend?");
    await page.getByRole("button", { name: "Bubble" }).click();
    const bubble = page.locator(".branch-host.bubble");
    const b0 = (await bubble.boundingBox())!;
    const grip = (await page.getByRole("button", { name: "Move the bubble" }).boundingBox())!;
    await page.mouse.move(grip.x + 10, grip.y + 10);
    await page.mouse.down();
    await page.mouse.move(grip.x + 10, grip.y + 110, { steps: 5 });
    await page.mouse.up();
    const b1 = (await bubble.boundingBox())!;
    expect(Math.round(b1.y - b0.y)).toBe(100);
    const corner = (await page.getByRole("button", { name: "Resize the bubble" }).boundingBox())!;
    await page.mouse.move(corner.x + 14, corner.y + 14);
    await page.mouse.down();
    await page.mouse.move(corner.x - 46, corner.y - 26, { steps: 5 });
    await page.mouse.up();
    const b2 = (await bubble.boundingBox())!;
    expect(Math.round(b1.width - b2.width)).toBe(60);
    // dragged far away it stays on screen
    const g2 = (await page.getByRole("button", { name: "Move the bubble" }).boundingBox())!;
    await page.mouse.move(g2.x + 10, g2.y + 10);
    await page.mouse.down();
    await page.mouse.move(g2.x + 900, g2.y + 2000, { steps: 4 });
    await page.mouse.up();
    const b3 = (await bubble.boundingBox())!;
    const wrap = (await page.locator(".chat-wrap").boundingBox())!;
    expect(b3.x + b3.width).toBeLessThanOrEqual(wrap.x + wrap.width + 1);
    expect(b3.y + b3.height).toBeLessThanOrEqual(wrap.y + wrap.height + 1);
    // minimize to ① and back, same size
    await page.getByRole("button", { name: "Minimize the bubble" }).click();
    await page.getByRole("button", { name: "Open the branch ①" }).click();
    expect(Math.round((await bubble.boundingBox())!.width)).toBe(Math.round(b3.width));

    // layer: one tap shows the original, the bar brings it back; see-through levels
    await page.getByRole("button", { name: "Split screen" }).click();
    await page.getByRole("button", { name: "Layer" }).click();
    const layer = page.locator(".branch-host.layer");
    await expect(layer).toBeVisible();
    await page.getByRole("button", { name: "Show the original" }).click();
    await expect(page.locator(".layer-bar")).toContainText("①");
    await page.locator(".layer-bar").click();
    await page.getByRole("button", { name: /See-through \(100%\)/ }).click();
    await expect(page.getByRole("button", { name: /See-through \(70%\)/ })).toBeVisible();
    expect(await layer.evaluate((el) => getComputedStyle(el).backgroundColor)).toMatch(/rgba|color\(|oklab|0\.7/);

    // landscape: the split goes left | right
    await page.getByRole("button", { name: "Split screen" }).click();
    await page.setViewportSize({ width: 915, height: 412 });
    const main = (await page.locator(".chat").boundingBox())!;
    const pane = (await page.locator(".branch-host.split").boundingBox())!;
    expect(pane.x).toBeGreaterThanOrEqual(main.x + main.width - 2);
  });

  test("keyboard (simulated): the top bar and the asked words stay, the branch folds to the question box, and the scroll comes back", async ({ page }) => {
    await mockOpenRouter(page, { answer: (q) => (q.includes("long") ? Array.from({ length: 14 }, (_, i) => `Paragraph ${i + 1} explains one more detail about light and air.`).join("\n\n") : "Short branch answer.") });
    await connect(page);
    await page.getByLabel("What do you want to understand?").fill("A long answer please");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.locator(".msg-ai .answer-text")).toContainText("Paragraph 14");
    await page.locator(".chat").evaluate((el) => (el.scrollTop = 200));
    await selectWords(page, 0, "Paragraph 6 explains");
    await bar(page).getByRole("button", { name: "Ask" }).click();
    const top = await page.locator(".chat").evaluate((el) => el.scrollTop);
    const words = (await page.locator(".chat mark.hl").boundingBox())!;
    await page.waitForTimeout(300); // the top bar's hide-on-scroll animation
    const barY = (await page.locator(".chat-bar").boundingBox())!.y;
    await page.setViewportSize({ width: 412, height: 520 });
    await page.waitForTimeout(300);
    // nothing slides up: the top bar is exactly where it was
    expect((await page.locator(".chat-bar").boundingBox())!.y).toBe(barY);
    await expect(page.locator(".chat mark.hl")).toBeInViewport();
    await expect(page.locator(".composer textarea")).toBeInViewport();
    const w2 = (await page.locator(".chat mark.hl").boundingBox())!;
    expect(w2.y).toBeLessThanOrEqual(words.y + 1);
    // the original still scrolls while typing
    await page.locator(".composer textarea").fill("Typing…");
    await page.locator(".chat").evaluate((el) => (el.scrollTop += 40));
    await expect(page.locator(".composer textarea")).toHaveValue("Typing…");
    await page.locator(".chat").evaluate((el) => (el.scrollTop -= 40));
    await page.locator(".composer textarea").blur();
    await page.setViewportSize({ width: 412, height: 839 });
    await expect.poll(() => page.locator(".chat").evaluate((el) => el.scrollTop)).toBe(top);
  });

  test("layout: nothing sideways and nothing tappable under 28px with a branch open", async ({ page }) => {
    await mockOpenRouter(page);
    await connect(page);
    await askRoot(page, "Why is the sky blue?");
    await askAbout(page, "depends on it", "Why does it depend?");
    for (const mode of ["Split screen", "Bubble", "Layer"]) {
      if (mode !== "Split screen") await page.getByRole("button", { name: mode }).first().click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      const small = await page.$$eval(".branch-host button, .follow-switch button", (els) =>
        els.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 27.5 || r.width < 27.5); }).map((e) => e.outerHTML.slice(0, 80)),
      );
      expect(small).toEqual([]);
      if (mode === "Bubble") await page.getByRole("button", { name: "Split screen" }).click();
    }
  });
});
