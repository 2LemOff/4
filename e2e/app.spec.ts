import { expect, test } from "@playwright/test";
import { mockOpenRouter } from "./mock";
import { askRoot, connect } from "./helpers";

test.describe("card stack", () => {
  test("ask, drill into a sentence, navigate with buttons and breadcrumbs", async ({ page }) => {
    const calls = await mockOpenRouter(page);
    await connect(page);
    await askRoot(page, "What is superposition?");

    // the hidden system prompt carries both directives verbatim, and Gemini's reasoning is requested
    const first = calls.stream[0];
    expect(first.messages[0].content).toContain("Never provide long, unbroken walls of text. Break answers into distinct, logical premises.");
    expect(first.messages[0].content).toContain("Speak in first principles. Assume the user will question the foundational logic of every claim you make.");
    expect(first.model).toBe("google/gemini-3.5-pro");
    expect(first.usage).toEqual({ include: true });

    // breadcrumb tag arrives from the tag model
    await expect(page.getByRole("navigation", { name: "Breadcrumbs" }).getByRole("button", { name: "Tag 1" })).toBeVisible();

    // reasoning is in a collapsed panel
    await expect(page.getByText("Show reasoning")).toBeVisible();
    await expect(page.getByText("Let me think.")).toBeHidden();
    await page.getByText("Show reasoning").click();
    await expect(page.getByText("Let me think.")).toBeVisible();

    // tap a sentence: the sentence becomes the header of a new card with an input
    await page.getByText("Premise two depends on it.", { exact: false }).first().click();
    await expect(page).toHaveURL(/\/d\/1\/0$/);
    await expect(page.locator("blockquote.anchor")).toHaveText("Premise two depends on it.");
    await expect(page.getByText("What do you want to ask about this?")).toBeVisible();
    await page.getByLabel("Type your question…").fill("Why does it depend on it?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.locator("blockquote.anchor")).toHaveText("Premise two depends on it.");
    await expect(page.locator(".block")).toHaveCount(3);

    // append-only: the child's request replays the parent's messages unchanged, quote only in the new turn
    const second = calls.stream[1];
    const firstMsgs = first.messages;
    expect(second.messages.slice(0, firstMsgs.length - 1)).toEqual(firstMsgs.slice(0, -1));
    expect(second.messages.at(-1).content).toBe('About this statement from your previous answer: "Premise two depends on it."\n\nMy question: Why does it depend on it?');
    const replayed = second.messages.find((m: any) => m.role === "assistant");
    expect(replayed.reasoning_details[0]).toMatchObject({ type: "reasoning.text", text: "Let me think. ", signature: "SIG123", format: "google-gemini-v1" });

    // ↑ Parent returns; the drilled sentence is marked with a count
    await page.getByRole("button", { name: /Parent/ }).click();
    await expect(page.locator(".sent.asked")).toHaveCount(1);
    await expect(page.locator(".sent.asked .count")).toHaveText("1");

    // a second question on another sentence becomes a sibling
    await page.getByText("Premise three concludes.").click();
    await page.getByLabel("Type your question…").fill("Is that final?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.getByLabel("Sibling questions")).toContainText("2 / 2");
    await page.getByRole("button", { name: "Previous question" }).click();
    await expect(page.getByLabel("Sibling questions")).toContainText("1 / 2");
    await expect(page.locator("blockquote.anchor")).toHaveText("Premise two depends on it.");
    await page.getByRole("button", { name: "Next question" }).click();
    await expect(page.getByLabel("Sibling questions")).toContainText("2 / 2");

    // breadcrumb teleports to the root
    await page.getByRole("navigation", { name: "Breadcrumbs" }).getByRole("button").first().click();
    await expect(page.locator("h1.question")).toHaveText("What is superposition?");
    // the way back down: the questions list
    await expect(page.getByText("Questions on this card (2)")).toBeVisible();
  });

  test("quick chips ask immediately, and history survives a reload", async ({ page }) => {
    const calls = await mockOpenRouter(page);
    await connect(page);
    await askRoot(page, "Explain entropy");
    await page.getByRole("button", { name: "Why?", exact: true }).click();
    await expect.poll(() => calls.stream.length).toBe(2);
    expect(calls.stream[1].messages.at(-1).content).toBe("Why?");
    await expect(page.getByLabel("Sibling questions")).toContainText("1 / 1");
    await expect(page.locator(".block")).toHaveCount(3);
    await page.reload();
    await expect(page.locator(".block")).toHaveCount(3);
    await page.goto("/#/");
    await expect(page.getByText("Explain entropy")).toBeVisible();
  });
});

test.describe("model settings", () => {
  async function openSettings(page: import("@playwright/test").Page) {
    await page.getByRole("button", { name: "Model settings" }).click();
  }
  async function pick(page: import("@playwright/test").Page, search: string) {
    await page.getByRole("button", { name: /Model for this question/ }).click();
    await page.getByLabel("Search models").fill(search);
    await page.getByRole("button", { name: new RegExp(search, "i") }).first().click();
  }

  test("each model shows only the controls it supports", async ({ page }) => {
    await mockOpenRouter(page);
    await connect(page);
    await openSettings(page);
    const sheet = page.getByRole("dialog", { name: "Model settings" });

    // Gemini: temperature + top-p + seed; mandatory reasoning has no off switch; thinking-level hint
    await expect(sheet.getByText("Temperature")).toBeVisible();
    await expect(sheet.getByText("Seed")).toBeVisible();
    await expect(sheet.getByText("Reasoning on")).toHaveCount(0);
    await expect(sheet.getByText(/thinking level/)).toBeVisible();

    // Claude Sonnet: no sampling controls, budget slider available, off switch present
    await pick(page, "claude-sonnet");
    await expect(sheet.getByText("Temperature")).toHaveCount(0);
    await expect(sheet.getByText("Reasoning on")).toBeVisible();
    await sheet.getByRole("radio", { name: "Token budget" }).click();
    await expect(sheet.getByLabel("Reasoning token budget")).toBeVisible();
    await expect(sheet.getByRole("radio", { name: "none" })).toHaveCount(0);

    // Claude Opus lists temperature
    await pick(page, "claude-opus");
    await expect(sheet.getByText("Temperature")).toBeVisible();

    // Grok: effort levels high / low only, no budget slider
    await pick(page, "grok");
    await expect(sheet.getByText("Reasoning on")).toBeVisible(); // off by default on this model
    await sheet.getByLabel("Reasoning on").check();
    await expect(sheet.getByRole("radio", { name: "high", exact: true })).toBeVisible();
    await expect(sheet.getByRole("radio", { name: "low", exact: true })).toBeVisible();
    await expect(sheet.getByRole("radio", { name: "medium", exact: true })).toHaveCount(0);
    await expect(sheet.getByRole("radio", { name: "Token budget" })).toHaveCount(0);
    await expect(sheet.getByText("Pro mode")).toHaveCount(0);

    // GPT-5.6: pro mode, reasoning context, verbosity
    await pick(page, "gpt-5.6");
    await expect(sheet.getByText("Pro mode")).toBeVisible();
    await expect(sheet.getByText("Reasoning context")).toBeVisible();
    await expect(sheet.getByText("Verbosity")).toBeVisible();
  });

  test("chosen reasoning settings are what gets sent", async ({ page }) => {
    const calls = await mockOpenRouter(page);
    await connect(page);
    await openSettings(page);
    const sheet = page.getByRole("dialog", { name: "Model settings" });
    await pick(page, "claude-sonnet");
    await sheet.getByRole("radio", { name: "minimal" }).click();
    await sheet.getByRole("button", { name: "Done" }).click();
    await askRoot(page, "Why is the sky blue?");
    const body = calls.stream[0];
    expect(body.model).toBe("anthropic/claude-sonnet-5.5");
    expect(body.reasoning).toEqual({ effort: "low" }); // Claude: minimal is sent as low
    expect(body.reasoning.max_tokens).toBeUndefined();
    expect(body.temperature).toBeUndefined();
    expect(body.max_tokens).toBeGreaterThan(4096);
    expect(body.messages[0].content[0].cache_control).toEqual({ type: "ephemeral" });
  });
});

test.describe("limits and recovery", () => {
  test("running out of room while thinking offers retries with more tokens", async ({ page }) => {
    let attempt = 0;
    const calls = await mockOpenRouter(page, {
      answer: () => (attempt++ === 0 ? "Premise one.\n\nPremise two.\n\nPremise three." : "Premise one is simple.\n\nPremise two depends on it.\n\nPremise three concludes."),
      stream: () => (attempt === 0 ? { finish: "length", usage: { prompt_tokens: 100, completion_tokens: 302, completion_tokens_details: { reasoning_tokens: 301 } } } : {}),
    });
    await connect(page);
    await page.getByLabel("What do you want to understand?").fill("Hard question");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.getByText("Ran out of room while thinking.")).toBeVisible();
    const before = calls.stream[0].max_tokens;
    await page.getByRole("button", { name: "More tokens" }).click();
    await expect.poll(() => calls.stream.length).toBe(2);
    expect(calls.stream[1].max_tokens).toBe(before * 2);
    await expect(page.getByText("Ran out of room while thinking.")).toBeHidden();
  });

  test("a nearly full branch offers a fresh linked branch", async ({ page }) => {
    const calls = await mockOpenRouter(page, { stream: () => ({ usage: { prompt_tokens: 750_000, completion_tokens: 5_000, cost: 1.2, completion_tokens_details: { reasoning_tokens: 0 } } }) });
    await connect(page);
    await askRoot(page, "A very long discussion");
    await expect(page.getByLabel(/Context used: 755k \/ 1M/)).toBeVisible();
    await page.getByRole("button", { name: "Continue in a fresh branch" }).first().click();
    await expect(page.getByText("Continue from: A very long discussion")).toBeVisible();
    expect(calls.json.some((b) => JSON.stringify(b).includes("Summarize the conversation"))).toBe(true);
    await expect(page.getByText("Continued from an earlier branch")).toBeVisible();
    await page.getByRole("button", { name: /Original/ }).click();
    await expect(page.getByText("Continued in a fresh branch ▸")).toBeVisible();
  });
});

test.describe("system prompt and synthesis settings", () => {
  test("edited system prompt applies to new sessions only", async ({ page }) => {
    const calls = await mockOpenRouter(page);
    await connect(page);
    await askRoot(page, "First session question");
    await page.goto("/#/settings/prompt");
    await expect(page.getByLabel("System prompt")).toHaveValue(/Speak in first principles/);
    await page.getByLabel("Directive 2: first principles").uncheck();
    await expect(page.getByLabel("System prompt")).not.toHaveValue(/Speak in first principles/);
    await page.goto("/#/");
    await askRoot(page, "Second session question");
    expect(calls.stream[0].messages[0].content).toContain("Speak in first principles");
    expect(calls.stream[1].messages[0].content).not.toContain("Speak in first principles");
    expect(calls.stream[1].messages[0].content).toContain("Never provide long, unbroken walls of text");
    // reset restores both directives
    await page.goto("/#/settings/prompt");
    await page.getByRole("button", { name: "Reset to default" }).click();
    await expect(page.getByLabel("System prompt")).toHaveValue(/Speak in first principles/);
  });

  test("synthesize with a custom prompt, then browse the library and follow a link", async ({ page }) => {
    const calls = await mockOpenRouter(page);
    await connect(page);
    await askRoot(page, "What is superposition?");
    await page.goto("/#/settings/synthesis");
    await page.getByLabel("Synthesis prompt").fill("Make flash-friendly notes.");
    await page.getByLabel("Language").fill("French");
    await page.goto("/#/");
    await page.getByText("What is superposition?").click();
    await expect(page.locator(".block")).toHaveCount(3);
    await page.getByRole("button", { name: "✦ Synthesize" }).click();
    await expect(page.getByText("Synthesizing in the background.")).toBeVisible();
    await page.getByRole("link", { name: "Library" }).first().click();
    await expect(page.getByText("Physics")).toBeVisible();
    await expect(page.getByText("Observers and premises")).toBeVisible();

    const synth = calls.json.find((b) => JSON.stringify(b).includes("concept_outline"));
    const sys = synth.messages[0].content;
    expect(sys).toContain("Make flash-friendly notes.");
    expect(sys).toContain("Write in French");
    expect(synth.response_format.json_schema.name).toBe("concept_outline");
    expect(synth.messages[1].content).toContain("Q: What is superposition?");

    await page.getByText("Observers and premises").click();
    await expect(page.getByText("Premise two depends on premise one.")).toBeVisible();
    await expect(page.getByText("A made-up card link.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Open the card this came from" })).toHaveCount(1); // the unknown id was dropped
    await page.getByRole("button", { name: "Open the card this came from" }).click();
    await expect(page.locator("h1.question")).toHaveText("What is superposition?");
  });

  test("per-run synthesis options override the defaults", async ({ page }) => {
    const calls = await mockOpenRouter(page);
    await connect(page);
    await askRoot(page, "Anything");
    await page.getByRole("button", { name: "Synthesis options for this run" }).click();
    const sheet = page.getByRole("dialog", { name: "Synthesize this session" });
    await sheet.getByLabel("Style").selectOption("flashcards");
    await sheet.getByRole("button", { name: "Synthesize with these settings" }).click();
    await expect(page.getByText("Synthesizing in the background.")).toBeVisible();
    await expect.poll(() => calls.json.some((b) => JSON.stringify(b).includes("flashcards"))).toBe(true);
  });
});

test.describe("search", () => {
  test("finds the exact card by concept and opens it in its branch", async ({ page }) => {
    const calls = await mockOpenRouter(page);
    await connect(page);
    await askRoot(page, "What is superposition?");
    await page.getByText("Premise two depends on it.", { exact: false }).first().click();
    await page.getByLabel("Type your question…").fill("Who counts as an observer?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.locator("blockquote.anchor")).toBeVisible();
    await page.getByRole("button", { name: "Search" }).click();
    await page.getByLabel("Search query").fill("Where did I ask about observers?");
    await page.getByRole("button", { name: "Search", exact: true }).last().click();
    await expect(page.getByText("mentions observers").first()).toBeVisible();
    expect(calls.embeddings.length).toBeGreaterThan(0);
    await page.getByRole("dialog", { name: "Search by concept" }).getByRole("button").filter({ hasText: "observers" }).first().click();
    await expect(page.locator(".block.hl")).toHaveCount(1);
  });

  test("falls back to word matching when offline or disconnected", async ({ page }) => {
    await mockOpenRouter(page);
    await connect(page);
    await askRoot(page, "What is superposition?");
    const cardUrl = page.url();
    await page.goto("/#/settings/account");
    await page.getByRole("button", { name: "Disconnect" }).click();
    await page.goto(cardUrl);
    await expect(page.locator(".block")).toHaveCount(3);
    await page.getByRole("button", { name: "Search" }).click();
    await page.getByLabel("Search query").fill("superposition");
    await page.getByRole("button", { name: "Search", exact: true }).last().click();
    await expect(page.getByText("matching words only")).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Search by concept" }).getByRole("button").filter({ hasText: "superposition" }).first()).toBeVisible();
  });
});

test.describe("mobile layout", () => {
  test("no horizontal scroll, buttons are at least 44px", async ({ page }) => {
    await mockOpenRouter(page);
    await connect(page);
    await askRoot(page, "Layout check");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const small = await page.$$eval("button.btn:not([hidden]), .tabs a", (els) =>
      els.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 43.5 || r.width < 43.5); }).map((e) => e.textContent),
    );
    expect(small).toEqual([]);
    await page.screenshot({ path: "test-results/card.png" });
  });
});
