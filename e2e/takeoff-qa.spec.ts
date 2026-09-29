// Takeoff quality checks in bid preflight, driven through the real UI.
//
// Both checks are WARNINGS: they name a sheet and a layer, they show in the
// Summary preflight panel, and they never stop a revision or an export.
//
// Sheet calibration: 200 PDF units = 20 ft  =>  0.1 ft per unit.
// Duplicate rule on a calibrated sheet: closer than 0.25 ft (3 in), which is
//   0.25 / 0.1 = 2.5 PDF units here. Two clicks on the same screen pixel land on
//   the same PDF point, distance 0 < 2.5, so they are flagged. The third count
//   is placed at (520, 642), 440 units from the others (44 ft): not a suspect.
//
// Bid arithmetic for the ready-to-issue assertion (3 counts, item $10 / 0.5 hr):
//   material = 3 x 10 = 30.00, labor hours = 3 x 0.5 = 1.5 at $100/hr = 150.00
//   prime    = 180.00, overhead 10% = 18.00, subtotal = 198.00
//   profit   = 10% of 198.00 = 19.80  =>  bid = 217.80
// The duplicate is still in that price: the warning reports, it does not remove.

import { test, expect, type Page } from "@playwright/test";
import { signIn, clickPdf, createBidSnapshot, expectPreflightReady } from "./helpers";

async function newProject(page: Page, label: string) {
  await signIn(page);
  await page.fill('input[placeholder="New project name…"]', `${label} ${Date.now()}`);
  await page.click('button:has-text("Create project")');
  await page.waitForURL("**/project/**");
  await page.waitForFunction(() => {
    const w = window as unknown as { __ws?: { getState(): { loaded: boolean } } };
    return w.__ws?.getState().loaded;
  });
  await page.evaluate(() => {
    const ws = (
      window as unknown as {
        __ws: { getState(): Record<string, CallableFunction> & { userId: string } };
      }
    ).__ws.getState();
    ws.upsertItem({
      id: "i-qa",
      user_id: ws.userId,
      code: "QA-REC",
      description: "Duplex receptacle",
      unit: "EA",
      material_cost: 10,
      labor_hours: 0.5,
    });
  });
}

async function waitForPdf(page: Page) {
  await page.waitForFunction(() => {
    const v = (window as never as Record<string, never>)["__voltview"] as unknown as
      | { pageW: number }
      | undefined;
    return !!v && v.pageW > 0;
  });
}

/** Upload the two-page sample plan and calibrate page 1 only (200 units = 20 ft). */
async function uploadAndCalibratePageOne(page: Page) {
  await page.setInputFiles('input[type="file"]', "e2e/fixtures/sample-plan.pdf");
  await waitForPdf(page);
  await page.keyboard.press("k");
  await clickPdf(page, 100, 732);
  await clickPdf(page, 300, 732);
  await page.fill('input[placeholder^="e.g."]', "20");
  await page.click('button:has-text("Set scale")');
  await expect(page.getByText("calibrated", { exact: true })).toBeVisible();
}

async function addReceptacleLayer(page: Page) {
  await page.click('button:has-text("+ Layer")');
  await page.fill('input[placeholder^="Layer name"]', "Receptacles");
  await page.click('button:has-text("Create layer")');
  await page.locator("select").first().selectOption({ label: "QA-REC — Duplex receptacle" });
}

test("two counts on the same spot warn in preflight, name the sheet and layer, and never block issuing", async ({
  page,
}) => {
  await newProject(page, "E2E Takeoff QA duplicates");
  await uploadAndCalibratePageOne(page);
  await addReceptacleLayer(page);

  // One far count, then the same spot twice.
  await clickPdf(page, 520, 642);
  await clickPdf(page, 80, 642);
  await clickPdf(page, 80, 642);
  await expect(page.getByText("3 EA")).toBeVisible();

  await page.click("button.tab >> text=summary");
  await page.getByTestId("labor-rate").fill("100");
  await page.getByTestId("overhead-pct").fill("10");
  await page.getByTestId("profit-pct").fill("10");
  await expect(page.getByTestId("bid-price")).toHaveText("$217.80");

  // Ready to issue, with the duplicate as the one advisory item.
  await expectPreflightReady(page);
  const preflight = page.getByTestId("bid-preflight");
  await expect(preflight).toContainText("0 blockers · 1 warning");
  const check = preflight.getByTestId("preflight-check-duplicate-counts");
  await expect(check).toBeVisible();
  await expect(check.getByTestId("preflight-warning")).toBeVisible();
  await expect(check.getByTestId("preflight-blocker")).toHaveCount(0);
  await expect(check).toContainText("Possible duplicate counts");
  await expect(check).toContainText("sample-plan p1, layer Receptacles");
  await expect(check).toContainText("2 counts in 1 spot within 3 in of each other");
  await expect(check).toContainText("up to 1 count is extra");
  // The far count is not a suspect, and the uncalibrated page 2 has nothing to warn about.
  await expect(preflight.getByTestId("preflight-check-empty-calibrated-sheets")).toHaveCount(0);

  // A warning does not stop issuing a revision or exporting.
  await expect(page.getByTestId("create-snapshot-btn")).toBeEnabled();
  await expect(page.getByRole("button", { name: "Export to Excel" })).toBeEnabled();
  await createBidSnapshot(page, "Issued with duplicate warning");
  await expect(page.getByTestId("revision-item-1")).toContainText("1 warning");

  // Undo the last placement: the pair is gone, so is the warning.
  await page.click("button.tab >> text=takeoff");
  await page.getByRole("button", { name: "Undo" }).click();
  await page.click("button.tab >> text=summary");
  await expect(page.getByTestId("preflight-check-duplicate-counts")).toHaveCount(0);
  await expectPreflightReady(page);
  await expect(page.getByTestId("bid-preflight")).toContainText("0 blockers · 0 warnings");

  // The frozen revision keeps the preflight it was issued with.
  await expect(page.getByTestId("revision-item-1")).toContainText("1 warning");
});

test("a calibrated sheet with no takeoffs warns; an uncalibrated sheet does not", async ({
  page,
}) => {
  await newProject(page, "E2E Takeoff QA empty sheet");
  await uploadAndCalibratePageOne(page);

  // Page 1 is calibrated and empty; page 2 has no scale, like a cover or a legend.
  await page.click("button.tab >> text=summary");
  const preflight = page.getByTestId("bid-preflight");
  const check = preflight.getByTestId("preflight-check-empty-calibrated-sheets");
  await expect(check).toBeVisible();
  await expect(check.getByTestId("preflight-warning")).toBeVisible();
  await expect(check.getByTestId("preflight-blocker")).toHaveCount(0);
  await expect(check).toContainText("sample-plan p1 is calibrated but has no confirmed takeoff");
  await expect(check).not.toContainText("sample-plan p2");
  // Nothing is priced yet, so the bid is blocked for that reason, not for this warning.
  await expect(preflight.getByTestId("preflight-check-empty-bid")).toBeVisible();
  await expect(preflight.getByTestId("preflight-check-duplicate-counts")).toHaveCount(0);

  // Measuring something on page 1 clears it.
  await page.click("button.tab >> text=takeoff");
  await waitForPdf(page);
  await addReceptacleLayer(page);
  await clickPdf(page, 80, 642);
  await expect(page.getByText("1 EA")).toBeVisible();
  await page.click("button.tab >> text=summary");
  await expect(page.getByTestId("preflight-check-empty-calibrated-sheets")).toHaveCount(0);
});
