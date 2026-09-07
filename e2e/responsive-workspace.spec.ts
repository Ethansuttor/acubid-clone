import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

const VIEWPORTS = [
  { width: 1440, height: 900, name: "desktop" },
  { width: 1024, height: 768, name: "laptop" },
  { width: 768, height: 900, name: "tablet" },
] as const;

test("summary and catalog remain usable without page-level horizontal overflow", async ({ page }) => {
  await signIn(page);
  await page.getByLabel("Project name", { exact: true }).fill(`Responsive ${Date.now()}`);
  await page.getByRole("button", { name: "Create project" }).click();
  await page.waitForURL("**/project/**");
  await page.getByRole("button", { name: "summary" }).click();

  for (const viewport of VIEWPORTS) {
    await test.step(viewport.name, async () => {
      await page.setViewportSize(viewport);
      await expect(page.getByTestId("bid-preflight")).toBeVisible();
      await expect(page.getByTestId("create-snapshot-btn")).toBeVisible();
      await expect(page.getByRole("button", { name: "+ Cost" })).toBeVisible();

      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }

  await page.getByRole("button", { name: "database" }).click();
  await expect(page.getByTestId("catalog-health")).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Item" })).toBeVisible();
  const databaseOverflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(databaseOverflow).toBeLessThanOrEqual(1);
});
