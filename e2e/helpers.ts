import type { Page } from "@playwright/test";

export const EMAIL = "ethan.suttor@gmail.com";
export const PASSWORD = "volt-takeoff-2026";

export async function signIn(page: Page) {
  await page.goto("/login");
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
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

/** Wait until pending Supabase writes settle. */
export async function waitSaved(page: Page) {
  await page.waitForFunction(() => {
    const ws = (window as never as Record<string, never>)["__ws"] as unknown as {
      getState(): { pendingWrites: number };
    };
    return ws && ws.getState().pendingWrites === 0;
  });
}
