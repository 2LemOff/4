import { expect, type Page } from "@playwright/test";

export async function connect(page: Page) {
  await page.goto("/#/settings/account");
  await page.getByLabel("OpenRouter API key").fill("sk-or-test");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Connected.")).toBeVisible();
  await page.goto("/#/");
}

/** Ask a first question from Home and wait for its pyramids (K1) to appear on the map. */
export async function askRoot(page: Page, question: string, prefix = "K1") {
  await page.getByLabel("What do you want to understand?").fill(question);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page).toHaveURL(/#\/s\/\w+\?focus=\w+/);
  await expect(item(page, `${prefix}.n6`)).toBeVisible();
}

export const item = (page: Page, id: string) => page.locator(`[data-item="${id}"]`);

/** Ask from the dock composer. */
export async function askDock(page: Page, question: string) {
  await page.locator(".dock textarea").fill(question);
  await page.locator(".dock").getByRole("button", { name: "Ask", exact: true }).click();
}
