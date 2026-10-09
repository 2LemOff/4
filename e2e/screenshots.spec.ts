import { test } from "@playwright/test";
import { mockOpenRouter } from "./mock";
import { askDock, connect, item } from "./helpers";

// Not part of the default run: `SCREENSHOTS=1 npx playwright test screenshots` writes docs/screenshots/*.png
test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to capture");

test("capture each screen", async ({ page }) => {
  await mockOpenRouter(page);
  await connect(page);
  const shot = (name: string) => page.screenshot({ path: `docs/screenshots/${name}.png` });
  await page.getByLabel("What do you want to understand?").fill("Why is the sky blue?\n\nI read that it is about scattering, but I don't get why blue and not violet.");
  await shot("1-home");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await item(page, "K1.n6").waitFor();
  await page.waitForTimeout(400);
  await shot("2-map");
  await item(page, "K1.n3").click();
  await page.waitForTimeout(200);
  await shot("3-point-selected");
  await askDock(page, "Why blue and not violet?");
  await item(page, "K2.n6").waitFor();
  await page.waitForTimeout(500);
  await shot("4-follow-up");
  await page.getByRole("button", { name: "Fit the whole map" }).click();
  await page.waitForTimeout(200);
  await shot("5-whole-map");
  await page.getByRole("button", { name: "Foundations", exact: true }).click();
  await page.waitForTimeout(300);
  await shot("6-foundations");
  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.getByRole("button", { name: "Outline" }).click();
  await page.waitForTimeout(300);
  await shot("7-outline");
  await page.goto("/#/settings/storage");
  await page.waitForTimeout(300);
  await shot("8-storage");
});
