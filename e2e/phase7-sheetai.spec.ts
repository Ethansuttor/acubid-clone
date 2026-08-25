// AI sheet analysis: title-block reading proposes a sheet name and a
// calibration derived from the printed drawing scale. Nothing is applied
// without confirmation, and the derived scale must measure correctly.
//
// At 1/4" = 1'-0", one inch of paper is 4 ft, and PDF space is 72 units per
// inch, so 4/72 = 0.05555.. ft per unit. The fixture's 200-unit scale bar
// therefore measures 200 x 4/72 = 11.111 ft = 11'-1" to the nearest inch.

import { test, expect } from "@playwright/test";
import { signIn, clickPdf } from "./helpers";

test("AI sheet analysis proposes names and scales for confirmation", async ({ page }) => {
  await page.route("**/api/sheetinfo", async (route) => {
    const body = route.request().postDataJSON() as { sheets: { id: string }[] };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      json: {
        model: "mock-analyzer",
        proposals: body.sheets.map((s, i) =>
          i === 0
            ? {
                id: s.id,
                sheetNumber: "E-101",
                sheetTitle: "POWER PLAN",
                scaleText: "1/4\" = 1'-0\"",
                feetPerInch: 4,
                confidence: 0.95,
              }
            : {
                id: s.id,
                sheetNumber: "E-102",
                sheetTitle: "DETAILS",
                scaleText: "NTS",
                feetPerInch: null,
                confidence: 0.9,
              }
        ),
      },
    });
  });

  await signIn(page);
  await page.fill('input[placeholder="New project name…"]', `E2E SheetAI ${Date.now()}`);
  await page.click('button:has-text("Create project")');
  await page.waitForURL("**/project/**");
  await page.setInputFiles('input[type="file"]', "e2e/fixtures/sample-plan.pdf");
  await page.waitForFunction(() => {
    const v = (window as never as Record<string, never>)["__voltview"] as unknown as { pageW: number } | undefined;
    return !!v && v.pageW > 0;
  });
  await expect(page.getByText("UNCALIBRATED", { exact: false })).toBeVisible();

  await page.click('button:has-text("✨ Read")');
  await expect(page.getByTestId("sheet-proposal")).toHaveCount(2, { timeout: 60_000 });

  // The not-to-scale sheet yields a name but no calibration
  const rows = page.getByTestId("sheet-proposal");
  await expect(rows.nth(0)).toContainText("E-101  POWER PLAN");
  await expect(rows.nth(0)).toContainText("1/4\" = 1'-0\"");
  await expect(rows.nth(1)).toContainText("NTS");
  await expect(rows.nth(1)).toContainText("not usable");

  // Nothing has changed until Apply
  await expect(page.getByText("UNCALIBRATED", { exact: false })).toBeVisible();

  await page.click('button:has-text("Apply all")');
  await page.click('button:has-text("Close")');

  // Sheet renamed and calibrated from the stated scale
  await expect(page.getByText("E-101  POWER PLAN")).toBeVisible();
  await expect(page.getByText(/CAL 1/)).toBeVisible();
  await expect(page.getByText('CAL 1"=4.0\'')).toBeVisible();

  // The derived calibration measures the 200-unit scale bar as 11'-1"
  await page.click('button:has-text("+ Layer")');
  await page.fill('input[placeholder^="Layer name"]', "Check run");
  await page.getByRole("button", { name: "linear", exact: true }).click();
  await page.click('button:has-text("Create layer")');
  await clickPdf(page, 100, 732);
  await clickPdf(page, 300, 732);
  await page.keyboard.press("Enter");
  await expect(page.getByText("11.1 FT")).toBeVisible();

  // Applying a scale is undoable
  await page.keyboard.press("v");
  await page.keyboard.press("Control+z"); // undo the linear run
  await page.keyboard.press("Control+z"); // undo the calibration
  await expect(page.getByText("UNCALIBRATED", { exact: false })).toBeVisible();
});
