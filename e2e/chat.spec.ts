import { expect, test, type Page } from "@playwright/test";
import { mockOpenRouter } from "./mock";
import { askDock, askRoot, connect, selectWords } from "./helpers";

const RULES = "Break answers into distinct, logical premises.\n\nWhen the query challenges something you said, re-examine it honestly: concede plainly if you were wrong, defend it with reasons if you were right, and say so when you are unsure.";
const answers = (page: Page) => page.locator(".msg-ai .answer-text");
const bar = (page: Page) => page.getByRole("toolbar", { name: "Selected text" });
const tray = (page: Page) => page.getByRole("group", { name: "Highlights in your question" });

test.describe("classic chat", () => {
  test("a new topic is answered in full text and shown whole, with a compact top bar", async ({ page }) => {
    const calls = await mockOpenRouter(page);
    await connect(page);
    await askRoot(page, "Why is the sky blue?");
    const first = calls.stream[0];
    expect(first.messages[0].content).toBe(RULES);
    expect(first.response_format).toBeUndefined();
    expect(first.messages.at(-1).content).toBe("Why is the sky blue?");

    await expect(page.locator(".msg-user .bubble")).toHaveText("Why is the sky blue?");
    await expect(answers(page)).toContainText("Premise one is simple.");
    await expect(answers(page)).toContainText("Premise three concludes.");
    await expect(page.getByText(/Read more/)).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);

    const top = (await page.locator(".chat-bar").boundingBox())!;
    expect(top.height).toBeLessThanOrEqual(41);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const small = await page.$$eval("button.btn, .chat-title", (els) =>
      els.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 27.5 || r.width < 27.5); }).map((e) => e.outerHTML.slice(0, 80)),
    );
    expect(small).toEqual([]);

    // the answer's menu has the details; the old map is one tap away
    await page.getByRole("button", { name: "Answer details" }).click();
    const sheet = page.getByRole("dialog", { name: "Answer" });
    await expect(sheet).toContainText("gemini-3.5-pro");
    await sheet.getByRole("button", { name: "Bookmark this answer" }).click();
    await expect(sheet.getByRole("button", { name: "Remove bookmark" })).toBeVisible();
    await sheet.getByRole("button", { name: "Open in the old map" }).click();
    await expect(page).toHaveURL(/#\/m\/\w+/);
    await page.goto("/#/");
    await page.getByRole("region", { name: "Bookmarks" }).getByRole("button", { name: /^Why is the sky blue/ }).click();
    await expect(page).toHaveURL(/#\/s\/\w+\?focus=/);
    await expect(answers(page)).toContainText("Premise one is simple.");
  });

  test("highlight words and ask: the prompt quotes them and starts a branch under that answer", async ({ page }) => {
    const calls = await mockOpenRouter(page);
    await connect(page);
    await askRoot(page, "Why is the sky blue?");
    await selectWords(page, 0, "depends on it");
    await expect(bar(page)).toBeVisible();
    await bar(page).getByRole("button", { name: "Ask" }).click();
    await expect(tray(page)).toContainText("depends on it");
    await expect(page.locator("mark.hl.picked")).toHaveText("depends on it");
    await expect(page.locator(".dock textarea")).toBeFocused();
    await askDock(page, "Why does it depend?");
    await expect.poll(() => calls.stream.length).toBe(2);
    const second = calls.stream[1];
    expect(second.messages.at(-1).content).toBe('About this part of your previous answer: "depends on it"\n\nMy question: Why does it depend?');
    // append-only: the earlier turn is replayed exactly
    expect(second.messages.slice(0, 2)).toEqual(calls.stream[0].messages);
    expect(second.messages[2].role).toBe("assistant");
    expect(second.messages[2].content).toContain("Premise three concludes.");

    await expect(answers(page)).toHaveCount(2);
    await expect(page.locator(".msg-user .quote-line")).toHaveText("depends on it");
    await expect(page.locator('mark.hl[data-n="↳ 1"]')).toHaveText("depends on it");
    await expect(tray(page)).toHaveCount(0);

    // tapping the mark shows the question asked about it
    await page.locator("mark.hl").click();
    const sheet = page.getByRole("dialog", { name: "Highlight" });
    await expect(sheet).toContainText("Why does it depend?");
    await sheet.getByRole("button", { name: "Add to the question" }).click();
    await expect(tray(page)).toContainText("depends on it");
    await tray(page).getByRole("button", { name: "Clear" }).click();
    await expect(tray(page)).toHaveCount(0);
  });

  test("several highlights from two answers go out as one prompt; another highlight branches, and ‹ › switches branches", async ({ page }) => {
    const calls = await mockOpenRouter(page);
    await connect(page);
    await askRoot(page, "Why is the sky blue?");
    await askDock(page, "Second question");
    await expect(answers(page)).toHaveCount(2);
    await expect(answers(page).nth(1)).toContainText("Premise three concludes.");

    await selectWords(page, 0, "Premise one is simple.");
    await bar(page).getByRole("button", { name: "Mark+" }).click();
    await selectWords(page, 1, "second sentence about observers");
    await bar(page).getByRole("button", { name: "Mark+" }).click();
    await expect(tray(page).locator(".tray-chip")).toHaveCount(2);
    await askDock(page, "How do these connect?");
    await expect.poll(() => calls.stream.length).toBe(3);
    const third = calls.stream[2];
    expect(third.messages.at(-1).content).toBe('About these parts of your previous answers:\n1. "Premise one is simple."\n2. "second sentence about observers"\n\nMy question: How do these connect?');
    // asked under the later of the two answers, so both are in the history
    expect(third.messages.map((m: any) => m.role)).toEqual(["system", "user", "assistant", "user", "assistant", "user"]);
    await expect(answers(page)).toHaveCount(3);
    await expect(page.locator('mark.hl[data-n="↳ 1"]')).toHaveCount(2);

    // a highlight in the first answer starts a new branch there
    await selectWords(page, 0, "Premise three concludes.");
    await bar(page).getByRole("button", { name: "Ask" }).click();
    await askDock(page, "Branch question");
    await expect.poll(() => calls.stream.length).toBe(4);
    expect(calls.stream[3].messages.map((m: any) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    await expect(answers(page)).toHaveCount(2);
    await expect(page.locator(".msg-user .bubble").last()).toHaveText("Branch question");
    await expect(page.locator(".chat-title")).toContainText("Premise three concludes.");
    const sibs = page.getByRole("group", { name: "Other questions asked here" });
    await expect(sibs).toContainText("2/2");
    await sibs.getByRole("button", { name: "Previous branch" }).click();
    await expect(page.locator(".msg-user .bubble")).toHaveText(["Why is the sky blue?", "Second question", "How do these connect?"]);

    // the Branches sheet lists the whole tree and opens any question
    await page.locator(".chat-title").click();
    const branches = page.getByRole("dialog", { name: "Branches" });
    await expect(branches.getByRole("button")).toHaveCount(5);
    await expect(branches.locator('[aria-current="true"]')).toHaveCount(3);
    await branches.getByRole("button", { name: /Branch question/ }).click();
    await expect(page.locator(".msg-user .bubble")).toHaveText(["Why is the sky blue?", "Branch question"]);
  });

  test("search opens the chat at the matching answer and marks the words", async ({ page }) => {
    await mockOpenRouter(page);
    await connect(page);
    await askRoot(page, "Why is the sky blue?");
    await page.getByRole("button", { name: "Topic menu" }).click();
    await page.getByRole("button", { name: /Search by concept/ }).click();
    await page.getByLabel("Search query").fill("what do observers see");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByRole("dialog", { name: "Search by concept" }).getByRole("button").filter({ hasText: /observers/ }).first().click();
    await expect(page).toHaveURL(/find=/);
    await expect(page.locator("mark.hl.flash")).toContainText("second sentence about observers");
  });
});
