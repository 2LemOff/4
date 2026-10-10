import { expect, test } from "@playwright/test";
import { mockOpenRouter } from "./mock";
import { askDock, askRoot, connect } from "./helpers";

test.describe("settings for every model task", () => {
  test("Settings › Models lists every task; a task's model, prompt and length are what gets sent", async ({ page }) => {
    const calls = await mockOpenRouter(page, {
      stream: () => ({ usage: { prompt_tokens: 750_000, completion_tokens: 5_000, cost: 1.2, completion_tokens_details: { reasoning_tokens: 0 } } }),
    });
    await connect(page);
    await page.goto("/#/settings/models");
    for (const group of ["Chat", "Council", "Views", "Photos", "Search and memory", "Stories"]) {
      await expect(page.getByRole("region", { name: group })).toBeVisible();
    }
    for (const task of ["Answers", "Quick answers", "Claim check", "Chairman", "Grounding check", "Arrange for views", "Text from images", "Search reranking", "Fresh-branch summary", "Story writer"]) {
      await expect(page.getByRole("button", { name: new RegExp(`^${task}`) })).toBeVisible();
    }

    // the answer's editor holds the system prompt too
    await page.getByRole("button", { name: /^Answers/ }).click();
    const answers = page.getByRole("dialog", { name: "Answers" });
    await expect(answers.getByText("Prompt (the hidden system prompt)")).toBeVisible();
    await expect(answers.getByLabel("Distinct, logical premises")).toBeChecked();
    await answers.getByRole("button", { name: "Done" }).click();

    // search reranking: another model and prompt
    await page.getByRole("button", { name: /^Search reranking/ }).click();
    const rerank = page.getByRole("dialog", { name: "Search reranking" });
    await rerank.getByRole("button", { name: /Search reranking model/ }).click();
    await page.getByLabel("Search models").fill("claude-opus");
    await page.getByRole("button", { name: /claude-opus-5\.5/ }).first().click();
    await rerank.getByLabel("Search reranking prompt").fill("Pick the two best candidates.");
    await expect(rerank.getByText("Added by the app (needed to read the reply)")).toBeVisible();
    await rerank.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("button", { name: /^Search reranking/ })).toContainText("claude-opus-5.5");

    // fresh-branch summary: a shorter length and a set max tokens
    await page.getByRole("button", { name: /^Fresh-branch summary/ }).click();
    const summary = page.getByRole("dialog", { name: "Fresh-branch summary" });
    await summary.getByRole("radio", { name: "80 words" }).click();
    await summary.locator('input[type="number"]').first().fill("999");
    await summary.getByRole("button", { name: "Done" }).click();

    await page.goto("/#/");
    await askRoot(page, "Why is the sky blue?");
    // reranking needs at least two answers to choose from
    await askDock(page, "And what do observers see?");
    await expect(page.locator(".answer-foot")).toHaveCount(2);
    await page.getByRole("button", { name: "Topic menu" }).click();
    await page.getByRole("button", { name: /Search by concept/ }).click();
    await page.getByLabel("Search query").fill("what do observers see");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByText(/Best matches by meaning/)).toBeVisible();
    const rr = calls.json.find((b) => JSON.stringify(b.messages).includes("Candidates:"))!;
    expect(rr.model).toBe("anthropic/claude-opus-5.5");
    const turn = rr.messages[0].content as string;
    expect(turn).toContain("Pick the two best candidates.");
    expect(turn).toContain('Reply with JSON only: {"results"');
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Answer details" }).last().click();
    await page.getByRole("button", { name: "Continue in a fresh branch" }).click();
    await expect.poll(() => calls.json.some((b) => JSON.stringify(b).includes("Summarize the conversation"))).toBe(true);
    const sum = calls.json.find((b) => JSON.stringify(b).includes("Summarize the conversation"))!;
    expect(sum.messages[0].content).toContain("Keep it under 80 words.");
    expect(sum.max_tokens).toBe(999);
    expect(sum.model).toBe("google/gemini-3.6-flash");
    await expect(page.locator(".msg-user .bubble").first()).toContainText("Continue from: And what do observers see?");
  });
});
