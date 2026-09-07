// Offline detector acceptance: real worker and PDF pixels, zero API requests.
// Every candidate stays pending until the estimator confirms it.

import { test, expect } from "@playwright/test";
import { signIn, pdfToScreen } from "./helpers";


test("phase 4: offline auto-count review queue", async ({ page }, testInfo) => {
  let apiCalls = 0;
  await page.route("**/api/autocount", async route => {
    apiCalls++;
    await route.abort();
  });

  await signIn(page);
  const name = `E2E Phase4 ${Date.now()}`;
  await page.fill('input[placeholder="New project name…"]', name);
  await page.click('button:has-text("Create project")');
  await page.waitForURL("**/project/**");

  // Seed one item so the layer extends into the estimate ($2.85 / 0.2hr)
  await page.waitForFunction(() => {
    const w = window as unknown as { __ws?: { getState(): { loaded: boolean } } };
    return w.__ws?.getState().loaded;
  });
  await page.evaluate(() => {
    const ws = (window as unknown as {
      __ws: { getState(): Record<string, CallableFunction> & { userId: string } };
    }).__ws.getState();
    ws.upsertItem({
      id: "i-dplx", user_id: ws.userId, code: "DPLX", description: "Duplex receptacle",
      unit: "EA", material_cost: 2.85, labor_hours: 0.2,
    });
  });

  await page.setInputFiles('input[type="file"]', "e2e/fixtures/sample-plan.pdf");
  await page.waitForFunction(() => {
    const v = (window as never as Record<string, never>)["__voltview"] as unknown as { pageW: number } | undefined;
    return !!v && v.pageW > 0;
  });

  // Count layer linked to the item
  await page.click('button:has-text("+ Layer")');
  await page.fill('input[placeholder^="Layer name"]', "Receptacles");
  await page.click('button:has-text("Create layer")');
  await page.locator("select").first().selectOption({ label: "DPLX — Duplex receptacle" });

  // Draw the AI example box around the receptacle at (80, 642)
  await page.keyboard.press("b");
  const p1 = await pdfToScreen(page, 66, 628);
  const p2 = await pdfToScreen(page, 94, 656);
  await page.mouse.move(p1.x, p1.y);
  await page.mouse.down();
  await page.mouse.move(p2.x, p2.y, { steps: 4 });
  await page.mouse.up();

  // Cancellation terminates the real worker/render without adding quantities;
  // a subsequent search must still be usable.
  await page.getByRole("button", { name: "Cancel search", exact: true }).click();
  await expect(page.getByText("Search cancelled. No candidates were added.")).toBeVisible();
  await expect(page.getByText(/pending detection\(s\)/)).toHaveCount(0);
  await expect(page.getByText("0 EA")).toBeVisible();
  await page.keyboard.press("b");
  await page.mouse.move(p1.x, p1.y);
  await page.mouse.down();
  await page.mouse.move(p2.x, p2.y, { steps: 4 });
  await page.mouse.up();

  // 6 pending detections; nothing counted yet
  await expect(page.getByText("6 pending detection(s)")).toBeVisible({ timeout: 60_000 });
  expect(apiCalls).toBe(0);
  await expect(page.getByTestId("detection-report")).toContainText("0 API calls");
  await expect(page.getByText("0 EA")).toBeVisible();

  // Repeating the same search must not duplicate pending marks.
  await page.keyboard.press("b");
  await page.mouse.move(p1.x, p1.y);
  await page.mouse.down();
  await page.mouse.move(p2.x, p2.y, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByTestId("detection-report")).toContainText("0 new candidates", { timeout: 60_000 });
  await expect(page.getByText("6 pending detection(s)")).toBeVisible();
  expect(apiCalls).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("offline-symbol-review.png"), fullPage: true });

  // Accept the first (Y): 5 pending, 1 counted
  await page.keyboard.press("y");
  await expect(page.getByText("5 pending detection(s)")).toBeVisible();
  await expect(page.getByText("1 EA")).toBeVisible();

  // Reject one (N): 4 pending, still 1 counted
  await page.keyboard.press("n");
  await expect(page.getByText("4 pending detection(s)")).toBeVisible();
  await expect(page.getByText("1 EA")).toBeVisible();

  // Accept all remaining (Shift+A): 0 pending, 5 counted (1 stayed rejected)
  await page.keyboard.press("Shift+A");
  await expect(page.getByText("5 EA")).toBeVisible();
  await expect(page.getByText(/pending detection/)).toHaveCount(0);

  // Review actions are undoable: undo the accept-all
  await page.keyboard.press("Control+z");
  await expect(page.getByText("4 pending detection(s)")).toBeVisible();
  await expect(page.getByText("1 EA")).toBeVisible();
  await page.keyboard.press("Control+Shift+z");
  await expect(page.getByText("5 EA")).toBeVisible();

  // The 5 accepted extend into the estimate: 5 x $2.85 = $14.25, 1.00 hr
  await page.click("button.tab >> text=estimate");
  await expect(page.getByText("$14.25")).toBeVisible();
  await expect(page.getByText("1.00 hr")).toBeVisible();
});
