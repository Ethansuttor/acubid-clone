import { expect, type Page } from "@playwright/test";

export const USERNAME = "1";

export async function signIn(page: Page) {
  await page.goto("/login");
  await page.fill('input[name="username"]', USERNAME);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/");
}

/** Map viewer-space PDF coords (top-left origin, scale-1 units) to screen px. */
export async function pdfToScreen(page: Page, x: number, y: number) {
  const v = await page.evaluate(() => (window as never as Record<string, never>)["__voltview"]);
  const view = v as unknown as {
    zoom: number; panX: number; panY: number; left: number; top: number;
  };
  return {
    x: view.left + view.panX + x * view.zoom,
    y: view.top + view.panY + y * view.zoom,
  };
}

export async function clickPdf(page: Page, x: number, y: number) {
  const p = await pdfToScreen(page, x, y);
  await page.mouse.click(p.x, p.y);
}

/** Wait until pending local persistence writes settle. */
export async function waitSaved(page: Page) {
  await page.waitForFunction(() => {
    const ws = (window as never as Record<string, never>)["__ws"] as unknown as {
      getState(): { pendingWrites: number };
    };
    return ws && ws.getState().pendingWrites === 0;
  });
}

/** Assert preflight is ready with no blockers. */
export async function expectPreflightReady(page: Page) {
  const preflight = page.getByTestId("bid-preflight");
  await expect(preflight).toBeVisible();
  await expect(preflight.getByRole("heading", { name: "Ready to issue" })).toBeVisible();
  await expect(preflight.getByTestId("preflight-blocker")).toHaveCount(0);
}

/** Assert preflight has blockers and optionally check for a specific check ID. */
export async function expectPreflightBlocker(page: Page, checkId?: string) {
  const preflight = page.getByTestId("bid-preflight");
  await expect(preflight).toBeVisible();
  await expect(preflight.getByRole("heading", { name: "Bid is not ready to issue" })).toBeVisible();
  if (checkId) {
    const check = preflight.getByTestId(`preflight-check-${checkId}`);
    await expect(check).toBeVisible();
    await expect(check.getByTestId("preflight-blocker")).toBeVisible();
  } else {
    await expect(preflight.getByTestId("preflight-blocker").first()).toBeVisible();
  }
}

/** Fill label (optional), create a snapshot, and assert success confirmation. */
export async function createBidSnapshot(page: Page, label?: string) {
  if (label !== undefined) {
    await page.getByTestId("snapshot-label-input").fill(label);
  }
  await page.getByTestId("create-snapshot-btn").click();
  await expect(page.getByTestId("snapshot-status")).toContainText("saved as a locked local snapshot");
}

/** Assert that a specific revision exists in the revision history list with optional price and label. */
export async function expectRevision(
  page: Page,
  revisionNumber: number,
  priceFormattedOrLabel?: string,
  label?: string
) {
  const item = page.getByTestId(`revision-item-${revisionNumber}`);
  await expect(item).toBeVisible();
  await expect(item.getByTestId("revision-badge")).toHaveText(`R${revisionNumber}`);

  let priceFormatted: string | undefined;
  let expectedLabel: string | undefined;

  if (label !== undefined) {
    priceFormatted = priceFormattedOrLabel;
    expectedLabel = label;
  } else if (priceFormattedOrLabel !== undefined) {
    if (priceFormattedOrLabel.startsWith("$") || /^\d/.test(priceFormattedOrLabel)) {
      priceFormatted = priceFormattedOrLabel;
    } else {
      expectedLabel = priceFormattedOrLabel;
    }
  }

  if (priceFormatted) {
    await expect(item.getByTestId("revision-price")).toContainText(priceFormatted);
  }
  if (expectedLabel) {
    await expect(item).toContainText(expectedLabel);
  }
}
