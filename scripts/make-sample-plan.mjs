// Generates a small two-page "electrical plan" PDF fixture with receptacle
// and fixture symbols plus a labeled 20 ft scale bar, used by the E2E tests.
// PDF coordinates are bottom-left origin; the viewer flips to top-left.

import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { writeFileSync, mkdirSync } from "node:fs";

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const black = rgb(0, 0, 0);

function drawReceptacle(page, x, y) {
  // duplex receptacle: circle with two parallel tick lines
  page.drawCircle({ x, y, size: 6, borderWidth: 1.2, borderColor: black });
  page.drawLine({ start: { x: x - 9, y: y + 3 }, end: { x: x + 9, y: y + 3 }, thickness: 1, color: black });
  page.drawLine({ start: { x: x - 9, y: y - 3 }, end: { x: x + 9, y: y - 3 }, thickness: 1, color: black });
}

function drawFixture(page, x, y) {
  // 2x4 troffer: rectangle with X
  page.drawRectangle({ x: x - 12, y: y - 6, width: 24, height: 12, borderWidth: 1.2, borderColor: black });
  page.drawLine({ start: { x: x - 12, y: y - 6 }, end: { x: x + 12, y: y + 6 }, thickness: 0.8, color: black });
  page.drawLine({ start: { x: x - 12, y: y + 6 }, end: { x: x + 12, y: y - 6 }, thickness: 0.8, color: black });
}

function drawRoom(page, label) {
  page.drawRectangle({ x: 50, y: 90, width: 500, height: 620, borderWidth: 2, borderColor: black });
  page.drawText(label, { x: 60, y: 720, size: 14, font, color: black });
  // scale bar: 200 pdf units = 20 ft  (0.1 ft/unit)
  page.drawLine({ start: { x: 100, y: 60 }, end: { x: 300, y: 60 }, thickness: 2, color: black });
  page.drawLine({ start: { x: 100, y: 54 }, end: { x: 100, y: 66 }, thickness: 2, color: black });
  page.drawLine({ start: { x: 300, y: 54 }, end: { x: 300, y: 66 }, thickness: 2, color: black });
  page.drawText("20 FT", { x: 185, y: 44, size: 10, font, color: black });
}

// Page 1: 6 receptacles + 4 fixtures
const p1 = doc.addPage([612, 792]);
drawRoom(p1, "E-101  POWER PLAN  (FIXTURE)");
const receptacles = [
  [80, 150], [80, 400], [80, 650], [520, 150], [520, 400], [520, 650],
];
for (const [x, y] of receptacles) drawReceptacle(p1, x, y);
const fixtures = [
  [200, 250], [400, 250], [200, 550], [400, 550],
];
for (const [x, y] of fixtures) drawFixture(p1, x, y);

// Page 2: 3 receptacles
const p2 = doc.addPage([612, 792]);
drawRoom(p2, "E-102  POWER PLAN  LEVEL 2");
for (const [x, y] of [[150, 200], [300, 500], [450, 200]]) drawReceptacle(p2, x, y);

mkdirSync("e2e/fixtures", { recursive: true });
writeFileSync("e2e/fixtures/sample-plan.pdf", await doc.save());
console.log("wrote e2e/fixtures/sample-plan.pdf");
