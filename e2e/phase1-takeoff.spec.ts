// Phase 1 verification: PDF rendering, calibration, count/linear/area tools,
// undo/redo, autosave + persistence.
//
// Fixture geometry (viewer coords, top-left origin, 612x792 page):
//   scale bar: (100,732) -> (300,732) = 200 units, labeled 20 FT  => 0.1 ft/unit
//   receptacles on page 1 at (80,642) (80,392) (80,142) (520,642) ...

import { test, expect } from "@playwright/test";
import { signIn, clickPdf, waitSaved } from "./helpers";

test("phase 1: render, calibrate, takeoff tools, undo, persistence", async ({ page }) => {
  await signIn(page);

  // Create a fresh project
  const name = `E2E Phase1 ${Date.now()}`;
  await page.fill('input[placeholder="New project name…"]', name);
  await page.click('button:has-text("Create project")');
  await page.waitForURL("**/project/**");

  // Upload the sample plan set
  await page.setInputFiles('input[type="file"]', "e2e/fixtures/sample-plan.pdf");
  await expect(page.getByText("sample-plan p1")).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => {
    const v = (window as never as Record<string, never>)["__voltview"] as unknown as { pageW: number } | undefined;
    return !!v && v.pageW > 0;
  });
  await expect(page.getByText("UNCALIBRATED", { exact: false })).toBeVisible();

  // Calibrate on the 20 ft scale bar
  await page.keyboard.press("k");
  await clickPdf(page, 100, 732);
  await clickPdf(page, 300, 732);
  await page.fill('input[placeholder^="e.g."]', "20");
  await page.click('button:has-text("Set scale")');
  await expect(page.getByText(/CAL 1/)).toBeVisible();

  // Count layer: click 3 receptacles
  await page.click('button:has-text("+ Layer")');
  await page.fill('input[placeholder^="Layer name"]', "Receptacles");
  await page.click('button:has-text("Create layer")');
  await clickPdf(page, 80, 642);
  await clickPdf(page, 80, 392);
  await clickPdf(page, 520, 642);
  await expect(page.getByText("3 EA")).toBeVisible();

  // Undo / redo
  await page.keyboard.press("Control+z");
  await expect(page.getByText("2 EA")).toBeVisible();
  await page.keyboard.press("Control+Shift+z");
  await expect(page.getByText("3 EA")).toBeVisible();

  // Linear layer along the scale bar: exactly 20 ft
  await page.click('button:has-text("+ Layer")');
  await page.fill('input[placeholder^="Layer name"]', "Feeder");
  await page.getByRole("button", { name: "linear", exact: true }).click();
  await page.click('button:has-text("Create layer")');
  await clickPdf(page, 100, 732);
  await clickPdf(page, 300, 732);
  await page.keyboard.press("Enter");
  await expect(page.getByText("20 FT")).toBeVisible();

  // Rise/drop allowance: +5 ft per run => 25 FT
  await page.getByTestId("layer-risedrop").fill("5");
  await expect(page.getByText("25 FT")).toBeVisible();

  // Area layer: 200x200 units = 20ft x 20ft = 400 SF
  await page.click('button:has-text("+ Layer")');
  await page.fill('input[placeholder^="Layer name"]', "Slab area");
  await page.getByRole("button", { name: "area", exact: true }).click();
  await page.click('button:has-text("Create layer")');
  await clickPdf(page, 100, 200);
  await clickPdf(page, 300, 200);
  await clickPdf(page, 300, 400);
  await clickPdf(page, 100, 400);
  await page.keyboard.press("Enter");
  await expect(page.getByText("400 SF")).toBeVisible();

  // Delete via selection: select tool, click a receptacle marker, Delete
  await page.keyboard.press("v");
  await clickPdf(page, 520, 642);
  await page.keyboard.press("Delete");
  await expect(page.getByText("2 EA")).toBeVisible();
  await page.keyboard.press("Control+z");
  await expect(page.getByText("3 EA")).toBeVisible();

  // Persistence: everything survives a reload
  await waitSaved(page);
  await page.reload();
  await expect(page.getByText("3 EA")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("25 FT")).toBeVisible();
  await expect(page.getByText("400 SF")).toBeVisible();
  await expect(page.getByText(/CAL 1/)).toBeVisible();

  // Second sheet renders independently
  await page.getByText("sample-plan p2").click();
  await expect(page.getByText("UNCALIBRATED", { exact: false })).toBeVisible();
});
