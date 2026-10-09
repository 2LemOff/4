import { expect, test } from "@playwright/test";
import { mockOpenRouter } from "./mock";
import { askDock, connect, item } from "./helpers";

test.describe("LLM Council", () => {
  test("toggle on: members answer, review, the chairman writes a grounded answer; follow-ups continue", async ({ page }) => {
    const calls = await mockOpenRouter(page);
    await connect(page);
    const toggle = page.getByRole("button", { name: "Council", exact: true });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(page.getByText(/Council on: each member answers/)).toBeVisible();
    await page.getByLabel("What do you want to understand?").fill("Why is the sky blue?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(item(page, "K1.n4")).toBeVisible();

    const members = ["google/gemini-3.5-pro", "anthropic/claude-opus-5.5", "openai/gpt-5.6-sol", "x-ai/grok-4.5"];
    const memberCalls = calls.stream.filter((b) => !JSON.stringify(b.messages).includes("COUNCIL RESPONSES"));
    expect(memberCalls.map((b) => b.model).sort()).toEqual([...members].sort());
    expect(calls.json.filter((b) => JSON.stringify(b).includes("You are evaluating different responses"))).toHaveLength(4);
    const chair = calls.stream.find((b) => JSON.stringify(b.messages).includes("COUNCIL RESPONSES"))!;
    expect(chair.model).toBe("google/gemini-3.5-pro");
    expect(chair.reasoning).toEqual({ enabled: true });
    const chairTurn = chair.messages.at(-1).content as string;
    expect(chairTurn).toContain("Use ONLY information that appears in the council's responses");
    expect(chairTurn).toContain("Response A:");
    expect(chairTurn).toContain("PEER REVIEWS");
    expect(chairTurn).toMatch(/\(Answer id prefix: K1\)$/);
    expect(calls.json.some((b) => JSON.stringify(b).includes("You check grounding"))).toBe(true);

    // n5 had no source and n6 was rejected by the verifier: both removed
    await expect(item(page, "K1.n5")).toHaveCount(0);
    await expect(item(page, "K1.n6")).toHaveCount(0);
    await page.locator(".item.qb").first().click();
    await page.locator(".council > summary").click();
    await expect(page.getByText("2 chairman point(s) weren't found in the council's answers and were removed.")).toBeVisible();
    await expect(page.getByText(/Response B · claude-opus-5.5 · average rank/)).toBeVisible();

    // follow-up with the council still on: every member gets the history
    const before = calls.stream.length;
    await askDock(page, "And at sunset?");
    await expect(item(page, "K2.n4")).toBeVisible();
    const round2 = calls.stream.slice(before).filter((b) => !JSON.stringify(b.messages).includes("COUNCIL RESPONSES"));
    expect(round2).toHaveLength(4);
    for (const b of round2) {
      expect(b.messages[1].content).toBe("Why is the sky blue?\n\n(Answer id prefix: K1)");
      expect(b.messages[2].role).toBe("assistant");
      expect(b.messages[2].reasoning).toBeUndefined();
      expect(b.messages[2].reasoning_details).toBeUndefined();
      expect(JSON.parse(b.messages[2].content).nodes.map((n: any) => n.id)).toEqual(["K1.n1", "K1.n2", "K1.n3", "K1.n4"]);
    }

    // council off: the chairman continues alone with the plain history
    await page.getByRole("button", { name: "Council", exact: true }).click();
    const n = calls.stream.length;
    await askDock(page, "Explain it simply");
    await expect.poll(() => calls.stream.length).toBe(n + 1);
    expect(calls.stream[n].model).toBe("google/gemini-3.5-pro");
    expect(calls.stream[n].messages.some((m: any) => String(m.content).includes("COUNCIL RESPONSES"))).toBe(false);
  });

  test("the chairman can be changed between questions, and any member can continue the chat", async ({ page }) => {
    const calls = await mockOpenRouter(page);
    await connect(page);
    await page.getByRole("button", { name: "Council", exact: true }).click();
    await page.getByLabel("What do you want to understand?").fill("Why is the sky blue?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(item(page, "K1.n4")).toBeVisible();

    await page.getByRole("button", { name: "Council settings" }).click();
    const sheet = page.getByRole("dialog", { name: "LLM Council" });
    await sheet.getByRole("button", { name: /^Chairman:/ }).click();
    await page.getByLabel("Search models").fill("claude-sonnet");
    await page.getByRole("button", { name: /claude-sonnet/ }).first().click();
    await sheet.getByRole("button", { name: "Done" }).click();
    const n = calls.stream.length;
    await askDock(page, "Second question");
    await expect(item(page, "K2.n4")).toBeVisible();
    const chair = calls.stream.slice(n).find((b) => JSON.stringify(b.messages).includes("COUNCIL RESPONSES"))!;
    expect(chair.model).toBe("anthropic/claude-sonnet-5.5");

    await page.locator(".item.qb").last().click();
    await page.locator(".council > summary").click();
    await page.getByText(/Response D · grok-4.5/).click();
    await page.getByRole("button", { name: "Continue with this model" }).click();
    await expect(page.getByRole("button", { name: "Council", exact: true })).toHaveAttribute("aria-pressed", "false");
    const m = calls.stream.length;
    await askDock(page, "Your view?");
    await expect.poll(() => calls.stream.length).toBe(m + 1);
    expect(calls.stream[m].model).toBe("x-ai/grok-4.5");
  });
});
