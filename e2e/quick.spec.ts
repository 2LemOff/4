import { expect, test } from "@playwright/test";
import { mockOpenRouter } from "./mock";
import { askDock, askRoot, connect, selectWords } from "./helpers";

const bar = (page: import("@playwright/test").Page) => page.getByRole("toolbar", { name: "Selected text" });

test.describe("quick answers and checks", () => {
  test("a quick answer about highlighted words: same history, short, checked, continued, then made a branch", async ({ page }) => {
    const calls = await mockOpenRouter(page);
    await connect(page);
    await askRoot(page, "Why is the sky blue?");
    await selectWords(page, 0, "depends on it");
    await bar(page).getByRole("button", { name: "Quick" }).click();
    const sheet = page.getByRole("dialog", { name: "Quick answer" });
    await expect(sheet.locator(".quote-block")).toHaveText("depends on it");
    await sheet.getByRole("button", { name: "Explain this" }).click();
    await expect(sheet).toContainText("A short quick answer.");
    const q = calls.stream[1];
    expect(q.model).toBe("google/gemini-3.6-flash");
    expect(q.max_tokens).toBe(1500);
    expect(q.messages.slice(0, 2)).toEqual(calls.stream[0].messages);
    expect(q.messages[2].role).toBe("assistant");
    expect(q.messages.at(-1).content).toMatch(/^Answer the question briefly[\s\S]*Answer in at most 3 sentences\.\n\nAbout this part of your previous answer: "depends on it"\n\nMy question: Explain this$/);

    // a second model checks it
    await sheet.getByRole("button", { name: "Check it" }).click();
    await expect(sheet).toContainText("✓ Checked: looks right: Matches the text.");
    // a follow-up carries the thread
    await sheet.getByLabel("Quick question").fill("Why?");
    await sheet.getByRole("button", { name: "Ask quickly" }).click();
    await expect(sheet).toContainText("Because it is short.");
    expect(calls.stream[2].messages.at(-3).content).toContain("My question: Explain this");
    expect(calls.stream[2].messages.at(-2).content).toBe("A short quick answer.");
    await sheet.getByRole("button", { name: "Close" }).click();

    // it sits under the answer in the chat, and isn't sent with the next question
    await expect(page.getByRole("region", { name: "Quick answer" })).toContainText("Because it is short.");
    await askDock(page, "Next question");
    await expect.poll(() => calls.stream.length).toBe(4);
    expect(JSON.stringify(calls.stream[3].messages)).not.toContain("A short quick answer.");
    await expect(page.locator(".answer-foot")).toHaveCount(2);

    // make it a branch: real questions and answers under the first answer
    await page.getByRole("region", { name: "Quick answer" }).getByRole("button", { name: /Quick/ }).click();
    await page.getByRole("dialog", { name: "Quick answer" }).getByRole("button", { name: "Make it a branch" }).click();
    await expect(page.locator(".msg-user .bubble")).toHaveText(["Why is the sky blue?", "Explain this", "Why?"]);
    await expect(page.locator(".msg-user .quote-line")).toHaveText("depends on it");
    await expect(page.getByRole("region", { name: "Quick answer" })).toHaveCount(0);
  });

  test("claim check splits highlighted words into claims; disputed ones underline the highlight; web search when chosen", async ({ page }) => {
    const calls = await mockOpenRouter(page);
    await connect(page);
    await page.goto("/#/settings/models");
    await page.getByRole("button", { name: /^Claim check/ }).click();
    await page.getByLabel(/Search the web while checking/).check();
    await page.getByRole("dialog", { name: "Claim check" }).getByRole("button", { name: "Done" }).click();
    await page.goto("/#/");
    await askRoot(page, "Why is the sky blue?");
    await selectWords(page, 0, "Premise two depends on it. It has a second sentence about observers.");
    await bar(page).getByRole("button", { name: "Check" }).click();
    const check = page.getByRole("region", { name: "Claim check" });
    await expect(check).toContainText("1 ✓ · 0 ? · 1 ✗");
    await expect(check).toContainText("Observers matter here");
    await expect(check).toContainText("(with web search)");
    await expect(page.locator("mark.hl.disputed")).toHaveCount(1);
    const req = calls.json.find((b) => JSON.stringify(b.messages).includes("Split the text into its distinct factual claims"))!;
    expect(req.plugins).toEqual([{ id: "web" }]);
    expect(req.model).toBe("anthropic/claude-sonnet-5.5");
    expect(req.messages[1].content).toContain('Text to check:\n"Premise two depends on it.');
  });
});
