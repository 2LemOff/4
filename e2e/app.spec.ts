import { expect, test, type Page } from "@playwright/test";
import { mockOpenRouter } from "./mock";
import { askDock, askRoot, connect, item } from "./helpers";

const center = async (page: Page, id: string) => {
  const b = (await item(page, id).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

test.describe("pyramid map", () => {
  test("an answer streams in as pyramids: foundations in categories above the conclusion", async ({ page }) => {
    const calls = await mockOpenRouter(page);
    await connect(page);
    await askRoot(page, "Why is the sky blue?");
    const first = calls.stream[0];
    expect(first.messages[0].content).toContain("Never provide long, unbroken walls of text. Break answers into distinct, logical premises.");
    expect(first.messages[0].content).toContain("Speak in first principles. Assume the user will question the foundational logic of every claim you make.");
    expect(first.messages[0].content).toContain("Answer format (required).");
    expect(first.messages.at(-1).content).toBe("Why is the sky blue?\n\n(Answer id prefix: K1)");
    expect(first.response_format.json_schema.name).toBe("pyramid_answer");

    // two unrelated pyramids, each with a conclusion; categories nested
    await expect(page.locator(".item.conclusion")).toHaveCount(2);
    await expect(page.locator('[data-group="K1.g1"]')).toHaveText("Light");
    await expect(page.locator('[data-group="K1.g2"]')).toHaveText("Scattering");
    expect((await center(page, "K1.n1")).y).toBeLessThan((await center(page, "K1.n3")).y);
    expect((await center(page, "K1.n3")).y).toBeLessThan((await center(page, "K1.n4")).y);
    // breadcrumb from the conclusion title
    await expect(page.getByRole("navigation", { name: "Breadcrumbs" })).toContainText("Blue sky");
  });

  test("ask about a point: the question links to it and the new pyramid builds on the earlier one", async ({ page }) => {
    const calls = await mockOpenRouter(page);
    await connect(page);
    await askRoot(page, "Why is the sky blue?");
    await item(page, "K1.n3").click();
    const panel = page.getByRole("region", { name: "Selected point" });
    await expect(panel).toContainText("Air molecules scatter blue light the most.");
    await expect(panel).toContainText("Rests on");
    await expect(panel).toContainText("Light is made of waves");
    await expect(panel).toContainText("Supports");
    await expect(page.locator(".anchor-chip")).toContainText("Asking about");
    await askDock(page, "Why blue and not violet?");
    await expect(item(page, "K2.n6")).toBeVisible();

    const second = calls.stream[1];
    expect(second.messages.at(-1).content).toBe('About this point from your previous answer: "Air molecules scatter blue light the most."\n\nMy question: Why blue and not violet?\n\n(Answer id prefix: K2)');
    // append-only: everything before the new turn is the first request plus its answer
    expect(second.messages.slice(0, 2)).toEqual(first(calls).slice(0, 2));
    expect(second.messages[2].role).toBe("assistant");
    expect(JSON.parse(second.messages[2].content).nodes[0].id).toBe("K1.n1");

    await expect(page.locator('[data-edge^="K1.n3>q:"]')).toHaveCount(1);
    await expect(page.locator('[data-edge="K1.n2>K2.n2"][data-style="builds"]')).toHaveCount(1);
    // selecting the new point highlights what it rests on in the earlier answer
    await item(page, "K2.n2").click();
    await expect(item(page, "K1.n2")).not.toHaveClass(/dim/);
    await expect(item(page, "K1.n5")).toHaveClass(/dim/);
  });

  test("several points, a category and a whole pyramid can be asked about", async ({ page }) => {
    const calls = await mockOpenRouter(page);
    await connect(page);
    await askRoot(page, "Why is the sky blue?");
    await page.getByRole("button", { name: "Select several points" }).click();
    await item(page, "K1.n1").click();
    await item(page, "K1.n5").click();
    await expect(page.locator(".anchor-chip")).toContainText("2 points");
    await askDock(page, "How do these connect?");
    await expect.poll(() => calls.stream.length).toBe(2);
    expect(calls.stream[1].messages.at(-1).content).toMatch(/^About these points from your previous answers:\n- "Light is made of waves[^\n]*"\n- "An observer only sees light/);
    await expect(item(page, "K2.n6")).toBeVisible();

    await page.getByRole("button", { name: "Fit the whole map" }).click();
    await page.locator('[data-group="K1.g2"]').click();
    await expect(page.locator(".anchor-chip")).toContainText("category “Scattering”");
    await askDock(page, "Is this always true?");
    await expect.poll(() => calls.stream.length).toBe(3);
    expect(calls.stream[2].messages.at(-1).content).toMatch(/^About this category from your previous answer:\n- \[Category\] Light\n  - \[Category\] Scattering\n    - Foundation: Tiny particles/);
    await expect(item(page, "K3.n6")).toBeVisible();

    await page.getByRole("button", { name: "Fit the whole map" }).click();
    await item(page, "K1.n4").click();
    await page.getByRole("button", { name: "Ask about the whole pyramid" }).click();
    await expect(page.locator(".anchor-chip")).toContainText("pyramid “Blue sky”");
    await askDock(page, "Summarize it");
    await expect.poll(() => calls.stream.length).toBe(4);
    expect(calls.stream[3].messages.at(-1).content).toMatch(/^About this pyramid from your previous answer:/);
    expect(calls.stream[3].messages.at(-1).content).not.toContain("observer");
  });

  test("foundations overview, zoom buttons and the outline view", async ({ page }) => {
    await mockOpenRouter(page);
    await connect(page);
    await askRoot(page, "Why is the sky blue?");
    const scale = async () => Number((await page.locator(".map-canvas").getAttribute("style"))!.match(/scale\(([\d.]+)\)/)![1]);
    const before = await scale();
    await page.getByRole("button", { name: "Zoom in" }).click();
    expect(await scale()).toBeGreaterThan(before);
    await page.getByRole("button", { name: "Fit the whole map" }).click();

    await page.getByRole("button", { name: "Foundations", exact: true }).click();
    await expect(item(page, "K1.n3")).toHaveCount(0);
    await expect(page.locator(".item.qb")).toHaveCount(0);
    await expect(page.locator('[data-edge="K1.n1>K1.n4"][data-style="supports"]')).toHaveCount(1);
    await page.getByRole("button", { name: "All", exact: true }).click();

    await page.getByRole("button", { name: "Outline" }).click();
    await expect(page).toHaveURL(/view=outline/);
    await expect(page.locator(".outline-group").first()).toHaveText("Light");
    await expect(page.locator(".outline-node.conclusion").first()).toContainText("Blue sky");
    await page.locator(".outline-node").filter({ hasText: "Air molecules" }).click();
    await expect(page.locator(".anchor-chip")).toContainText("Air molecules");
  });

  test("drag pans the map and a two-finger pinch zooms it", async ({ page }) => {
    await mockOpenRouter(page);
    await connect(page);
    await askRoot(page, "Why is the sky blue?");
    const t = async () => {
      const m = (await page.locator(".map-canvas").getAttribute("style"))!.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/)!;
      return { x: Number(m[1]), y: Number(m[2]), k: Number(m[3]) };
    };
    const map = page.getByTestId("map");
    const box = (await map.boundingBox())!;
    const a = await t();
    await map.dispatchEvent("pointerdown", { pointerId: 1, clientX: box.x + 40, clientY: box.y + 40, isPrimary: true });
    await map.dispatchEvent("pointermove", { pointerId: 1, clientX: box.x + 120, clientY: box.y + 90 });
    await map.dispatchEvent("pointerup", { pointerId: 1, clientX: box.x + 120, clientY: box.y + 90 });
    const b = await t();
    expect(b.x - a.x).toBeGreaterThan(50);
    await map.dispatchEvent("pointerdown", { pointerId: 2, clientX: box.x + 100, clientY: box.y + 100 });
    await map.dispatchEvent("pointerdown", { pointerId: 3, clientX: box.x + 140, clientY: box.y + 100 });
    await map.dispatchEvent("pointermove", { pointerId: 3, clientX: box.x + 220, clientY: box.y + 100 });
    await map.dispatchEvent("pointerup", { pointerId: 3 });
    await map.dispatchEvent("pointerup", { pointerId: 2 });
    expect((await t()).k).toBeGreaterThan(b.k * 2);
  });
});

function first(calls: Awaited<ReturnType<typeof mockOpenRouter>>) {
  return calls.stream[0].messages;
}

test.describe("compact UI, input and bookmarks", () => {
  test("the first input grows for pasted paragraphs and keeps them", async ({ page }) => {
    const calls = await mockOpenRouter(page);
    await connect(page);
    const text = "First paragraph about light.\n\nSecond paragraph about air.\n\nThird paragraph about eyes and what an observer sees.";
    const box = page.getByLabel("What do you want to understand?");
    await box.fill(text);
    const fits = await box.evaluate((el: HTMLTextAreaElement) => el.scrollHeight <= el.clientHeight + 2);
    expect(fits).toBe(true);
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect.poll(() => calls.stream.length).toBe(1);
    expect(calls.stream[0].messages.at(-1).content).toContain("Second paragraph about air.\n\nThird paragraph");
  });

  test("quick questions are hidden behind a toggle", async ({ page }) => {
    const calls = await mockOpenRouter(page);
    await connect(page);
    await askRoot(page, "Why is the sky blue?");
    await expect(page.getByRole("button", { name: "Why?", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Quick questions" }).click();
    await page.getByRole("button", { name: "Why?", exact: true }).click();
    await expect.poll(() => calls.stream.length).toBe(2);
    expect(calls.stream[1].messages.at(-1).content).toBe("Why?\n\n(Answer id prefix: K2)");
  });

  test("a black-and-white bookmark saves a point and reopens it", async ({ page }) => {
    await mockOpenRouter(page);
    await connect(page);
    await askRoot(page, "Why is the sky blue?");
    await item(page, "K1.n3").click();
    const panel = page.getByRole("region", { name: "Selected point" });
    await panel.getByRole("button", { name: "Bookmark" }).click();
    await expect(panel.getByRole("button", { name: "Remove bookmark" })).toHaveAttribute("aria-pressed", "true");
    expect(await panel.getByRole("button", { name: "Remove bookmark" }).locator("svg").getAttribute("fill")).toBe("currentColor");
    await page.goto("/#/");
    const list = page.getByRole("region", { name: "Bookmarks" });
    await expect(list).toContainText("Air molecules scatter blue light the most.");
    await list.getByRole("button", { name: /^Air molecules/ }).click();
    await expect(page.getByRole("region", { name: "Selected point" })).toContainText("Air molecules scatter blue light the most.");
    await page.goto("/#/library");
    await expect(page.getByRole("region", { name: "Bookmarks" })).toContainText("Air molecules");
  });

  test("no horizontal scroll and nothing smaller than 28px to tap", async ({ page }) => {
    await mockOpenRouter(page);
    await connect(page);
    await askRoot(page, "Layout check");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const small = await page.$$eval("button.btn, .tabs a, .crumb, .seg button", (els) =>
      els.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 27.5 || r.width < 27.5); }).map((e) => e.outerHTML.slice(0, 80)),
    );
    expect(small).toEqual([]);
    const topbar = (await page.locator(".topbar").boundingBox())!;
    expect(topbar.height).toBeLessThan(50);
  });
});

test.describe("model settings", () => {
  async function pick(page: Page, search: string) {
    await page.getByRole("button", { name: /Model for this question/ }).click();
    await page.getByLabel("Search models").fill(search);
    await page.getByRole("button", { name: new RegExp(search, "i") }).first().click();
  }

  test("each model shows only the controls it supports", async ({ page }) => {
    await mockOpenRouter(page);
    await connect(page);
    await page.getByRole("button", { name: "Model settings" }).click();
    const sheet = page.getByRole("dialog", { name: "Model settings" });
    await expect(sheet.getByText("Temperature")).toBeVisible();
    await expect(sheet.getByText("Reasoning on")).toHaveCount(0);
    await expect(sheet.getByText(/thinking level/)).toBeVisible();
    await pick(page, "claude-sonnet");
    await expect(sheet.getByText("Temperature")).toHaveCount(0);
    await sheet.getByRole("radio", { name: "Token budget" }).click();
    await expect(sheet.getByLabel("Reasoning token budget")).toBeVisible();
    await pick(page, "grok");
    await sheet.getByLabel("Reasoning on").check();
    await expect(sheet.getByRole("radio", { name: "high", exact: true })).toBeVisible();
    await expect(sheet.getByRole("radio", { name: "medium", exact: true })).toHaveCount(0);
    await pick(page, "gpt-5.6");
    await expect(sheet.getByText("Pro mode")).toBeVisible();
    await expect(sheet.getByText("Reasoning context")).toBeVisible();
  });

  test("chosen reasoning settings are what gets sent", async ({ page }) => {
    const calls = await mockOpenRouter(page);
    await connect(page);
    await page.getByRole("button", { name: "Model settings" }).click();
    const sheet = page.getByRole("dialog", { name: "Model settings" });
    await pick(page, "claude-sonnet");
    await sheet.getByRole("radio", { name: "minimal" }).click();
    await sheet.getByRole("button", { name: "Done" }).click();
    await askRoot(page, "Why is the sky blue?");
    const body = calls.stream[0];
    expect(body.model).toBe("anthropic/claude-sonnet-5.5");
    expect(body.reasoning).toEqual({ effort: "low" });
    expect(body.messages[0].content[0].cache_control).toEqual({ type: "ephemeral" });
  });
});

test.describe("limits, prompts and synthesis", () => {
  test("running out of room while thinking offers retries", async ({ page }) => {
    let attempt = 0;
    const calls = await mockOpenRouter(page, {
      stream: () => (attempt++ === 0 ? { finish: "length", usage: { prompt_tokens: 100, completion_tokens: 302, completion_tokens_details: { reasoning_tokens: 301 } } } : {}),
    });
    await connect(page);
    await askRoot(page, "Hard question");
    await page.locator(".item.qb").first().click();
    await expect(page.getByText("Ran out of room while thinking.")).toBeVisible();
    const before = calls.stream[0].max_tokens;
    await page.getByRole("button", { name: "More tokens" }).click();
    await expect.poll(() => calls.stream.length).toBe(2);
    expect(calls.stream[1].max_tokens).toBe(before * 2);
  });

  test("a nearly full branch offers a fresh linked branch", async ({ page }) => {
    const calls = await mockOpenRouter(page, { stream: () => ({ usage: { prompt_tokens: 750_000, completion_tokens: 5_000, cost: 1.2, completion_tokens_details: { reasoning_tokens: 0 } } }) });
    await connect(page);
    await askRoot(page, "A very long discussion");
    await page.locator(".item.qb").first().click();
    await expect(page.getByLabel(/Context used: 755k \/ 1M/)).toBeVisible();
    await page.getByRole("button", { name: "Continue in a fresh branch" }).click();
    await expect(page.locator(".item.qb").filter({ hasText: "Continue from: A very long discussion" })).toBeVisible();
    expect(calls.json.some((b) => JSON.stringify(b).includes("Summarize the conversation"))).toBe(true);
  });

  test("edited system prompt applies to new topics only", async ({ page }) => {
    const calls = await mockOpenRouter(page);
    await connect(page);
    await askRoot(page, "First topic");
    await page.goto("/#/settings/prompt");
    await page.getByLabel("Directive 2: first principles").uncheck();
    await expect(page.getByText("Answer format (fixed, added after your prompt)")).toBeVisible();
    await page.goto("/#/");
    await askRoot(page, "Second topic");
    expect(calls.stream[0].messages[0].content).toContain("Speak in first principles");
    expect(calls.stream[1].messages[0].content).not.toContain("Speak in first principles");
    expect(calls.stream[1].messages[0].content).toContain("Answer format (required).");
  });

  test("synthesize with a custom prompt, then follow a link back to the map", async ({ page }) => {
    const calls = await mockOpenRouter(page);
    await connect(page);
    await askRoot(page, "What is superposition?");
    await page.goto("/#/settings/synthesis");
    await page.getByLabel("Synthesis prompt").fill("Make flash-friendly notes.");
    await page.goto("/#/");
    await page.getByRole("button", { name: /What is superposition/ }).click();
    await expect(item(page, "K1.n6")).toBeVisible();
    await page.getByRole("button", { name: "Synthesize" }).click();
    await expect(page.getByText("Synthesizing in the background.")).toBeVisible();
    await page.goto("/#/library");
    await expect(page.getByText("Observers and premises")).toBeVisible();
    const synth = calls.json.find((b) => JSON.stringify(b).includes("concept_outline"));
    expect(synth.messages[0].content).toContain("Make flash-friendly notes.");
    expect(synth.messages[1].content).toContain("Foundation: Light is made of waves");
    await page.getByText("Observers and premises").click();
    await page.getByRole("button", { name: "Open the card this came from" }).click();
    await expect(item(page, "K1.n1")).toBeVisible();
  });
});

test.describe("search", () => {
  test("finds a point by concept and selects it on the map", async ({ page }) => {
    const calls = await mockOpenRouter(page);
    await connect(page);
    await askRoot(page, "Why is the sky blue?");
    await page.getByRole("button", { name: "Search" }).click();
    await page.getByLabel("Search query").fill("what does an observer see with their eyes");
    await page.getByRole("button", { name: "Search", exact: true }).last().click();
    await expect(page.getByText("Matches by meaning")).toBeVisible();
    expect(calls.embeddings.some((b) => b.dimensions === 512)).toBe(true);
    await page.getByRole("dialog", { name: "Search by concept" }).getByRole("button").filter({ hasText: /observer/i }).first().click();
    await expect(page.getByRole("region", { name: "Selected point" })).toContainText(/observer/i);
  });

  test("falls back to word matching when disconnected", async ({ page }) => {
    await mockOpenRouter(page);
    await connect(page);
    await askRoot(page, "What is superposition?");
    const url = page.url();
    await page.goto("/#/settings/account");
    await page.getByRole("button", { name: "Disconnect" }).click();
    await page.goto(url);
    await page.getByRole("button", { name: "Search" }).click();
    await page.getByLabel("Search query").fill("observer");
    await page.getByRole("button", { name: "Search", exact: true }).last().click();
    await expect(page.getByText("matching words only")).toBeVisible();
  });
});

test.describe("storage and backup", () => {
  test("storage lists topics with sizes; backup shares one zip that restores elsewhere", async ({ page, browser }) => {
    await page.addInitScript(() => {
      (navigator as any).canShare = () => true;
      (navigator as any).share = async ({ files }: { files: File[] }) => {
        const buf = new Uint8Array(await files[0].arrayBuffer());
        (window as any).__shared = { name: files[0].name, bytes: Array.from(buf) };
      };
    });
    await mockOpenRouter(page);
    await connect(page);
    await askRoot(page, "Why is the sky blue?");
    await item(page, "K1.n3").click();
    await page.getByRole("region", { name: "Selected point" }).getByRole("button", { name: "Bookmark" }).click();
    await page.goto("/#/settings/storage");
    await expect(page.getByText("Protected from automatic cleanup:")).toBeVisible();
    const row = page.locator(".file-row").filter({ hasText: "Why is the sky blue?" });
    await expect(row).toContainText(/text [\d.]+ (B|KB)/);
    await row.getByRole("checkbox").check();
    await expect(page.getByText(/Frees about/)).toBeVisible();
    await row.getByRole("checkbox").uncheck();

    await page.getByRole("button", { name: "Back up", exact: true }).click();
    await expect(page.getByText(/Backup shared/)).toBeVisible();
    await expect(page.getByText(/Last backup:/)).toBeVisible();
    const shared = await page.evaluate(() => (window as any).__shared);
    expect(shared.name).toMatch(/^fractal-backup-\d{4}-\d{2}-\d{2}\.zip$/);
    const zip = Buffer.from(shared.bytes);
    expect(zip.includes(Buffer.from("sk-or-test"))).toBe(false);

    const fresh = await browser.newContext({ serviceWorkers: "block" });
    const p2 = await fresh.newPage();
    await mockOpenRouter(p2);
    await p2.goto("/#/settings/storage");
    await p2.locator('input[type="file"]').setInputFiles({ name: shared.name, mimeType: "application/zip", buffer: zip });
    await expect(p2.getByText(/Restored 1 topics/)).toBeVisible();
    await p2.goto("/#/");
    await expect(p2.getByRole("region", { name: "Bookmarks" })).toContainText("Air molecules");
    await p2.getByRole("button", { name: /^Why is the sky blue/ }).click();
    await expect(item(p2, "K1.n6")).toBeVisible();
    await fresh.close();
  });

  test("an old v1 text answer still opens, shown as a chain", async ({ page }) => {
    await mockOpenRouter(page);
    await connect(page);
    await page.evaluate(async () => {
      const open = indexedDB.open("fractal");
      const dbh: IDBDatabase = await new Promise((r) => (open.onsuccess = () => r(open.result)));
      const tx = dbh.transaction(["sessions", "cards"], "readwrite");
      tx.objectStore("sessions").put({ id: "old1", title: "Old topic", rootCardId: "oc1", lastCardId: "oc1", systemPrompt: "Old prompt", answerModel: "google/gemini-3.5-pro", createdAt: 1, updatedAt: 1 });
      tx.objectStore("cards").put({ id: "oc1", sessionId: "old1", parentId: null, question: "Old question", blocks: ["First old paragraph.", "Second old paragraph."], assistant: { content: "First old paragraph.\n\nSecond old paragraph." }, model: "google/gemini-3.5-pro", status: "done", createdAt: 1 });
      await new Promise((r) => (tx.oncomplete = r));
      dbh.close();
    });
    await page.goto("/#/s/old1/c/oc1");
    await expect(page.locator(".item.foundation")).toContainText("First old paragraph.");
    await expect(page.locator(".item.conclusion")).toContainText("Second old paragraph.");
    await page.getByRole("button", { name: "Outline" }).click();
    await expect(page.getByText("wasn't in pyramid form")).toBeVisible();
  });
});
