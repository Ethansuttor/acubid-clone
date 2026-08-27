// Phase 4 verification: AI auto-count review flow with the detection API
// mocked (no ANTHROPIC_API_KEY in the sandbox). Verifies:
//   - drawing an example box triggers tiling + detection request
//   - detections land as PENDING and contribute NOTHING to the estimate
//   - keyboard review: Y accept, N reject, Shift+A accept-all
//   - only accepted detections extend into quantities/estimate
//   - review actions are undoable
//
// Under the default "ncc-verify" strategy the browser locates candidates
// itself with deterministic template matching and the API only VERIFIES crops,
// so this spec mocks the verify call: the first ACCEPTED_CANDIDATES crops match
// and the rest do not. That fixes the review queue at exactly 6 pending
// regardless of how many candidates the matcher proposes, which keeps this
// spec about the review-queue invariant rather than detector accuracy.
//
// It does assume the matcher finds at least 6 candidates on the fixture plan;
// if that stops being true the precondition assertion below says so plainly.

import { test, expect } from "@playwright/test";
import { signIn, pdfToScreen } from "./helpers";

const ACCEPTED_CANDIDATES = 6;

test("phase 4: auto-count review queue", async ({ page }) => {
  let verifiedCrops = 0;
  await page.route("**/api/autocount", async (route) => {
    const body = route.request().postDataJSON() as {
      mode?: string;
      crops?: { index: number }[];
      tiles?: { x: number; y: number; w: number; h: number }[];
    };

    if (body.mode === "verify") {
      const crops = body.crops ?? [];
      verifiedCrops += crops.length;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: {
          verifications: crops.map((c) => ({
            index: c.index,
            match: c.index <= ACCEPTED_CANDIDATES,
            confidence: 0.95 - (c.index - 1) * 0.05,
          })),
          model: "mock-verifier",
        },
      });
      return;
    }

    // Legacy whole-tile path, kept so the spec still works if
    // DETECTION_STRATEGY is switched back to "tile-scan".
    const tiles = body.tiles ?? [];
    const canvasW = Math.max(...tiles.map((t) => t.x + t.w));
    const S = canvasW / 612;
    const receptacles: [number, number][] = [
      [80, 642], [80, 392], [80, 142], [520, 642], [520, 392], [520, 142],
    ];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      json: {
        detections: receptacles.map(([cx, cy], i) => ({
          x: cx * S - 12, y: cy * S - 12, w: 24, h: 24, confidence: 0.95 - i * 0.05,
        })),
        tilesProcessed: tiles.length,
        model: "mock-detector",
        warnings: [],
      },
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
  await expect(page.getByText("6 pending detection(s)")).toBeVisible({ timeout: 60_000 });
  expect(
    verifiedCrops,
    `the matcher proposed ${verifiedCrops} candidates; this spec needs at least ${ACCEPTED_CANDIDATES}`
  ).toBeGreaterThanOrEqual(ACCEPTED_CANDIDATES);
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
