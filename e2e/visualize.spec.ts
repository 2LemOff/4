import { expect, test } from "@playwright/test";
import { mockOpenRouter } from "./mock";
import { askDock, askRoot, connect, selectWords } from "./helpers";

const arrangeCalls = (calls: { json: any[] }) => calls.json.filter((b) => JSON.stringify(b.messages).includes("Arrange the numbered sentences"));

test.describe("Visualize", () => {
  test("a whole answer as Levels, Big idea and Mind map from one arrangement; every sentence kept; tap shows the exact words", async ({ page }) => {
    const calls = await mockOpenRouter(page);
    await connect(page);
    await askRoot(page, "Why is the sky blue?");
    await page.getByRole("button", { name: "Visualize this answer" }).click();
    const sheet = page.getByRole("dialog", { name: "Visualize" });
    await expect(sheet).toContainText("4 sentences, all kept word for word");
    await sheet.getByRole("listitem").filter({ hasText: "Levels" }).click();
    await expect(page).toHaveURL(/#\/v\/\w+\?view=levels/);

    // levels from broad to narrow, with dashed neighbours and +N instead of sideways scrolling
    await expect(page.getByRole("region", { name: "Level 1: Science" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Level 3: Optics" })).toContainText("How light behaves.");
    const science = page.getByRole("region", { name: "Level 1: Science" });
    await expect(science.locator(".ghost")).toHaveCount(4);
    await science.getByRole("button", { name: "+1" }).click();
    await expect(science.locator(".ghost")).toHaveCount(5);
    // the arranger left one sentence unplaced: it isn't lost
    const here = page.getByRole("region", { name: "This answer" });
    await expect(here).toContainText("Premises");
    await expect(here).toContainText("Other details");

    const arrange = arrangeCalls(calls);
    expect(arrange).toHaveLength(1);
    expect(arrange[0].model).toBe("google/gemini-3.6-flash");
    const user = arrange[0].messages[1].content as string;
    expect(user).toContain("[s1] Premise one is simple.");
    expect(user).toContain("[s4] Premise three concludes.");

    // what else is on this level
    await page.getByRole("button", { name: "What else is on the level of Physics?" }).click();
    await expect(page.getByRole("region", { name: "Level 2: Physics" }).locator(".ghost").filter({ hasText: "Geology" })).toBeVisible();

    // other views come from the same arrangement: no new request
    await page.getByRole("tab", { name: "Big idea → details" }).click();
    await expect(page.locator(".big-title")).toHaveText("Why the sky is blue");
    await page.getByRole("tab", { name: "Mind map" }).click();
    await expect(page.locator(".vnode.center")).toContainText("Why the sky is blue");
    await page.getByRole("tab", { name: "Outline" }).click();
    await expect(page.locator(".outline-group").first()).toHaveText("Premises");
    expect(arrangeCalls(calls)).toHaveLength(1);

    // tap anything: the exact sentence, and back to it in the answer
    await page.getByRole("tab", { name: "Argument chain" }).click();
    await page.locator(".vrow").filter({ hasText: "Premise one is simple." }).first().click();
    const detail = page.getByRole("dialog", { name: "Label s1" });
    await expect(detail.locator(".quote-block")).toHaveText("Premise one is simple.");
    await detail.getByRole("button", { name: "Show in the answer" }).click();
    await expect(page).toHaveURL(/#\/s\/\w+\?focus=\w+&find=/);
    await expect(page.locator("mark.hl.flash")).toHaveText("Premise one is simple.");

    // saved under the answer, and reopened without a new request
    await page.getByRole("button", { name: "Visuals (1)" }).click();
    await page.getByRole("dialog", { name: "Visuals of this answer" }).getByRole("button", { name: /Why is the sky blue/ }).click();
    await expect(page.locator(".big-title")).toBeVisible();
    expect(arrangeCalls(calls)).toHaveLength(1);
  });

  test("highlights from two answers: compare first, a diagram cites the exact words; Read more only outside the chat", async ({ page }) => {
    const long = "This is a deliberately long sentence about how short blue waves bounce off tiny air molecules many more times than the long red waves do, which is why the daytime sky looks blue to anyone standing on the ground and looking up. ".repeat(3).trim();
    const calls = await mockOpenRouter(page, { answer: (q) => (q.includes("Second") ? `Second answer. ${long}` : "Premise one is simple.\n\nPremise two depends on it.") });
    await connect(page);
    await page.getByLabel("What do you want to understand?").fill("First question");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.locator(".answer-foot")).toHaveCount(1);
    await askDock(page, "Second question");
    await expect(page.locator(".answer-foot")).toHaveCount(2);
    // no Read more in the chat, however long the answer
    await expect(page.getByText("Read more")).toHaveCount(0);

    await selectWords(page, 0, "Premise one is simple.");
    await page.getByRole("toolbar", { name: "Selected text" }).getByRole("button", { name: "Mark+" }).click();
    await selectWords(page, 1, "Second answer.");
    await page.getByRole("toolbar", { name: "Selected text" }).getByRole("button", { name: "Mark+" }).click();
    await page.getByRole("group", { name: "Highlights in your question" }).getByRole("button", { name: "Visualize" }).click();
    const sheet = page.getByRole("dialog", { name: "Visualize" });
    await expect(sheet).toContainText("2 highlights");
    await expect(sheet.getByRole("listitem").first()).toContainText("Compare table");
    await expect(sheet.getByRole("listitem").first()).toContainText("Fits best");
    await sheet.getByRole("listitem").filter({ hasText: "Compare table" }).click();
    await expect(page.locator(".vtable")).toContainText("First");
    const diagram = calls.json.find((b) => JSON.stringify(b.messages).includes("a comparison table"))!;
    expect(diagram.messages[1].content).toContain("[s1] Premise one is simple.");
    expect(diagram.messages[1].content).toContain("[s2] Second answer.");
    expect(diagram.response_format.json_schema.name).toBe("diagram_compare");
    await page.locator(".vtable").getByRole("button", { name: "another" }).click();
    await expect(page.getByRole("dialog", { name: "Says · Second" }).locator(".quote-block")).toHaveText("Second answer.");
    await page.keyboard.press("Escape");

    // a concept map from the same selection; an unknown source id is ignored
    await page.getByRole("tab", { name: /Diagrams|Compare table/ }).click();
    await page.getByRole("dialog", { name: "Diagrams and pictures" }).getByRole("button", { name: /Concept map/ }).click();
    await expect(page.locator(".vnode").filter({ hasText: "Premise one" })).toBeVisible();

    // Read more lives in the views: a whole-answer study doc of the long answer is cut
    await page.goto("/#/settings/views");
    await page.getByLabel("Lines before Read more").fill("2");
    await page.goBack();
    await page.goBack();
    await page.getByRole("button", { name: "Back to the chat" }).click();
    await page.getByRole("button", { name: "Visualize this answer" }).last().click();
    await page.getByRole("dialog", { name: "Visualize" }).getByRole("listitem").filter({ hasText: "Study doc" }).click();
    await expect(page.getByRole("button", { name: "Read more" }).first()).toBeVisible();
  });

  test("the whole topic as a study doc with a side chat that continues the topic", async ({ page }) => {
    const calls = await mockOpenRouter(page);
    await connect(page);
    await askRoot(page, "Why is the sky blue?");
    await page.getByRole("button", { name: "Topic menu" }).click();
    await page.getByRole("button", { name: /Visualize the whole topic/ }).click();
    await page.getByRole("dialog", { name: "Visualize" }).getByRole("listitem").filter({ hasText: "Study doc" }).click();
    await expect(page.locator(".doc-section").first()).toContainText("Premise one is simple.");
    const side = page.getByRole("region", { name: "Side chat" });
    await side.locator("textarea").fill("What is the weakest premise?");
    await side.getByRole("button", { name: "Ask" }).click();
    await expect(side.locator(".bubble")).toHaveText("What is the weakest premise?");
    await expect(side.locator(".answer-text")).toContainText("Premise three concludes.");
    expect(calls.stream.at(-1).messages.at(-1).content).toBe("What is the weakest premise?");
    // it's a real branch of the topic
    await page.getByRole("button", { name: "Back to the chat" }).click();
    await expect(page.locator(".msg-user .bubble").last()).toHaveText("What is the weakest premise?");
  });
});
