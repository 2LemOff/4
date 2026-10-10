import { expect, type Page } from "@playwright/test";

export async function connect(page: Page) {
  await page.goto("/#/settings/account");
  await page.getByLabel("OpenRouter API key").fill("sk-or-test");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Connected.")).toBeVisible();
  await page.goto("/#/");
}

/** Ask a first question from Home; it opens in the chat. Waits for the mock's full-text answer. */
export async function askRoot(page: Page, question: string) {
  await page.getByLabel("What do you want to understand?").fill(question);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page).toHaveURL(/#\/s\/\w+\?focus=\w+/);
  await expect(page.locator(".msg-ai .answer-text").last()).toContainText("Premise three concludes.");
}

/** New topics answer as pyramids (for the old map). */
export async function usePyramids(page: Page) {
  await page.goto("/#/settings/prompt");
  await page.getByLabel("Pyramid points (for the old map)").check();
  await page.goto("/#/");
}

/** Ask a first question as a pyramid topic, then open it on the old map and wait for its pyramids (K1). */
export async function askRootMap(page: Page, question: string, prefix = "K1", opts: { setFormat?: boolean } = {}) {
  if (opts.setFormat !== false) await usePyramids(page);
  await page.getByLabel("What do you want to understand?").fill(question);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page).toHaveURL(/#\/s\/\w+\?focus=\w+/);
  await page.goto(page.url().replace("#/s/", "#/m/"));
  await expect(item(page, `${prefix}.n6`)).toBeVisible();
}

export const item = (page: Page, id: string) => page.locator(`[data-item="${id}"]`);

/** Ask from the dock composer (the map's or the chat's). */
export async function askDock(page: Page, question: string) {
  await page.locator(".dock textarea").fill(question);
  await page.locator(".dock").getByRole("button", { name: "Ask", exact: true }).click();
}

/** Select words inside an answer of the chat, the way a long-press does. */
export async function selectWords(page: Page, cardIndex: number, words: string) {
  // highlighting starts once an answer has finished
  await expect(page.locator("[data-answer]").nth(cardIndex)).toBeAttached();
  await page.evaluate(
    ({ cardIndex, words }) => {
      const box = document.querySelectorAll<HTMLElement>("[data-answer]")[cardIndex];
      const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const i = n.nodeValue!.indexOf(words);
        if (i < 0) continue;
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + words.length);
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(r);
        return;
      }
      throw new Error(`"${words}" not found in answer ${cardIndex}`);
    },
    { cardIndex, words },
  );
}
