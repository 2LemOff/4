import { expect, type Page } from "@playwright/test";

export async function connect(page: Page) {
  await page.goto("/#/settings/account");
  await page.getByLabel("OpenRouter API key").fill("sk-or-test");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Connected.")).toBeVisible();
  await page.goto("/#/");
}

export async function askRoot(page: Page, question: string) {
  await page.getByLabel("What do you want to understand?").fill(question);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page).toHaveURL(/#\/s\/\w+\/c\/\w+/);
  await expect(page.locator(".block")).toHaveCount(3);
}
