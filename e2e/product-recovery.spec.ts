import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { signIn, waitSaved, createBidSnapshot, expectRevision } from "./helpers";

test("archive and portable recovery preserve a bid, revision and plan PDF", async ({ page, browser }, testInfo) => {
  await signIn(page);
  await page.getByLabel("Project name", { exact: true }).fill("Recovery acceptance bid");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(page.getByText("Recovery acceptance bid", { exact: true })).toBeVisible();
  await page.getByText("Estimate setup ·", { exact: false }).click();
  await expect(page.getByRole("button", { name: /Set up pricing/ })).toBeVisible();
  await page.getByText("Estimate setup ·", { exact: false }).click();
  await page.locator('input[type="file"][accept="application/pdf"]').setInputFiles("e2e/fixtures/sample-plan.pdf");
  await expect(page.getByText("sample-plan p1", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "summary", exact: true }).click();
  await page.getByRole("button", { name: "+ Cost (Add direct job cost)", exact: true }).click();
  await page.getByLabel("Description for direct cost new cost").fill("Equipment rental");
  await page.getByLabel("Amount for Equipment rental").fill("1234.56");
  await page.getByLabel("Amount for Equipment rental").blur();
  await waitSaved(page);
  await createBidSnapshot(page, "Issued base bid");
  await page.getByRole("link", { name: "Back to projects", exact: true }).click();
  await page.getByRole("button", { name: "Archive Recovery acceptance bid", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open Recovery acceptance bid", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Show archived projects", exact: true }).click();
  await page.getByRole("button", { name: "Restore Recovery acceptance bid", exact: true }).click();
  await page.getByRole("button", { name: "Show active projects", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open Recovery acceptance bid", exact: true })).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download backup", exact: true }).click();
  const download = await downloadPromise;
  const backupPath = testInfo.outputPath("recovery.voltline.json");
  await download.saveAs(backupPath);

  // An occupied workspace refuses replacement and retains the original project.
  await page.getByLabel("Backup file", { exact: true }).setInputFiles(backupPath);
  await page.getByRole("button", { name: "Restore this backup", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Restore requires an empty workspace");
  await expect(page.getByRole("button", { name: "Open Recovery acceptance bid", exact: true })).toBeVisible();

  const recoveredContext = await browser.newContext();
  const recovered = await recoveredContext.newPage();
  await recovered.goto("http://localhost:3000/login");
  await recovered.getByRole("button", { name: "Open workspace", exact: true }).click();
  await recovered.getByLabel("Backup file", { exact: true }).setInputFiles(backupPath);
  await expect(recovered.getByRole("heading", { name: "Ready to restore" })).toBeVisible();
  await recovered.getByRole("button", { name: "Restore this backup", exact: true }).click();
  await recovered.getByRole("button", { name: "Open Recovery acceptance bid", exact: true }).click();
  await expect(recovered.getByText("sample-plan p1", { exact: true })).toBeVisible();
  await recovered.getByRole("button", { name: "summary", exact: true }).click();
  await expect(recovered.getByTestId("bid-price")).toHaveText("$1,234.56");
  await expectRevision(recovered, 1, "$1,234.56", "Issued base bid");

  // Inspect actual IndexedDB binaries in the recovered profile, not just labels.
  const restoredBytes = await recovered.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open("voltline-local-v1");
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    const blobs = await new Promise<Blob[]>((resolve, reject) => {
      const request = db.transaction("files").objectStore("files").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return Array.from(new Uint8Array(await blobs[0].arrayBuffer()));
  });
  expect(Buffer.from(restoredBytes)).toEqual(await readFile("e2e/fixtures/sample-plan.pdf"));
  await recoveredContext.close();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Download backup", exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "Download backup", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("mobile-dashboard.png"), fullPage: true });
});

test("concurrent dashboard writes retain both projects", async ({ page, context }) => {
  await signIn(page);
  const second = await context.newPage();
  await second.goto("/");
  await page.getByLabel("Project name", { exact: true }).fill("Concurrent A");
  await second.getByLabel("Project name", { exact: true }).fill("Concurrent B");
  await Promise.all([
    page.getByRole("button", { name: "Create project", exact: true }).click(),
    second.getByRole("button", { name: "Create project", exact: true }).click(),
  ]);
  await expect(page).toHaveURL(/\/project\//);
  await expect(second).toHaveURL(/\/project\//);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Open Concurrent A", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Concurrent B", exact: true })).toBeVisible();
});

test("another editing tab is blocked until the first editor leaves", async ({ page, context }) => {
  await signIn(page);
  await page.getByLabel("Project name", { exact: true }).fill("One editor bid");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(page.getByRole("button", { name: "summary", exact: true })).toBeVisible();
  const second = await context.newPage();
  await second.goto(page.url());
  await expect(second.getByRole("heading", { name: "Workspace is open in another tab" })).toBeVisible();
  await page.getByRole("link", { name: "Back to projects", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
  await second.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(second.getByRole("button", { name: "summary", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Download backup", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("An estimate is open in another tab");
});
