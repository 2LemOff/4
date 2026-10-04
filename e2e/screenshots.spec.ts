import { test } from "@playwright/test";
import { mockOpenRouter } from "./mock";
import { askRoot, connect } from "./helpers";

// Not part of the default run: `SCREENSHOTS=1 npx playwright test screenshots` writes docs/screenshots/*.png
test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to capture");

test("capture each screen", async ({ page }) => {
  await mockOpenRouter(page);
  await connect(page);
  const shot = (name: string) => page.screenshot({ path: `docs/screenshots/${name}.png` });
  await shot("1-home");
  await askRoot(page, "What is superposition?");
  await page.waitForTimeout(400);
  await shot("2-card");
  await page.getByText("Premise two depends on it.", { exact: false }).first().click();
  await page.waitForTimeout(400);
  await shot("3-drill");
  await page.getByLabel("Type your question…").fill("Who counts as an observer?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "Model settings" }).click();
  await shot("4-model-settings");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "✦ Synthesize" }).click();
  await page.waitForTimeout(800);
  await page.goto("/#/library");
  await page.waitForTimeout(300);
  await shot("5-library");
  await page.getByText("Observers and premises").click();
  await page.waitForTimeout(300);
  await shot("6-outline");
  await page.goto("/#/settings/prompt");
  await shot("7-system-prompt");
  await page.goto("/#/settings/synthesis");
  await shot("8-synthesis-settings");
});
