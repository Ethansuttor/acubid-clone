// Phase 4 verification: AI auto-count review flow with the detection API
// mocked (no ANTHROPIC_API_KEY in the sandbox). Verifies:
//   - drawing an example box triggers tiling + detection request
//   - detections land as PENDING and contribute NOTHING to the estimate
//   - keyboard review: Y accept, N reject, Shift+A accept-all
//   - only accepted detections extend into quantities/estimate
//   - review actions are undoable
//
// The mock returns 6 detections at the fixture plan's receptacle locations
// (viewer coords (80,642)(80,392)(80,142)(520,642)(520,392)(520,142)),
// scaled into rendered-canvas pixels using S inferred from the tile extents.

import { test, expect } from "@playwright/test";
import { signIn, pdfToScreen } from "./helpers";

const RECEPTACLES: [number, number][] = [
  [80, 642], [80, 392], [80, 142], [520, 642], [520, 392], [520, 142],
];

test("phase 4: auto-count review queue", async ({ page }) => {
  await page.route("**/api/autocount", async (route) => {
    const body = route.request().postDataJSON() as {
      tiles: { x: number; y: number; w: number; h: number }[];
    };
    // canvas width = 612 * S; tiles cover the canvas exactly
    const canvasW = Math.max(...body.tiles.map((t) => t.x + t.w));
    const S = canvasW / 612;
    const detections = RECEPTACLES.map(([cx, cy], i) => ({
      x: cx * S - 12,
      y: cy * S - 12,
      w: 24,
      h: 24,
      confidence: 0.95 - i * 0.05,
    }));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      json: { detections, tilesProcessed: body.tiles.length, model: "mock-detector", warnings: [] },
    });
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

  // 6 pending detections; nothing counted yet
  await expect(page.getByText("6 pending detection(s)")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("0 EA")).toBeVisible();

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
