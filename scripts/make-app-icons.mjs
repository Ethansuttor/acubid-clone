// Generates the installed-app icons from one vector definition, so the PNGs in
// src/app/ are reproducible rather than mystery binaries. Rendered with the
// Chromium that Playwright already provides — no image toolchain to install.
//
//   node scripts/make-app-icons.mjs
//
// Design: the "night drafting table" identity from globals.css — ink-950
// ground, a faint blueprint grid, and the volt-amber bolt. Flat fill rather
// than a stroked outline because the taskbar renders this at about 24px.

import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";

const INK = "#0b0f14";
const GRID = "#33455a";
const VOLT = "#ffb224";

// Bolt polygon in a 512 box, centred on (256, 256).
const BOLT = "M300 72 L150 290 L236 290 L200 440 L362 214 L274 214 Z";

/**
 * @param {{maskable?: boolean}} opts
 * maskable icons are cropped to a circle by the platform, so the artwork has
 * to stay inside the middle 80% and the background must bleed to the edges.
 */
function svg({ maskable = false } = {}) {
  const radius = maskable ? 0 : 112;
  const scale = maskable ? 0.62 : 1;
  const gridOpacity = maskable ? 0.1 : 0.14;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <pattern id="grid" width="64" height="64" patternUnits="userSpaceOnUse">
      <path d="M64 0 H0 V64" fill="none" stroke="${GRID}" stroke-width="2" opacity="${gridOpacity}"/>
    </pattern>
  </defs>
  <rect width="512" height="512" rx="${radius}" ry="${radius}" fill="${INK}"/>
  <rect width="512" height="512" rx="${radius}" ry="${radius}" fill="url(#grid)"/>
  ${maskable ? "" : `<rect x="3" y="3" width="506" height="506" rx="${radius - 3}" ry="${radius - 3}"
     fill="none" stroke="${VOLT}" stroke-width="6" opacity="0.28"/>`}
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
    <path d="${BOLT}" fill="${VOLT}" stroke="${VOLT}" stroke-width="8" stroke-linejoin="round"/>
  </g>
</svg>`;
}

const targets = [
  { file: "src/app/icon.png", size: 512, maskable: false },
  { file: "public/icon-192.png", size: 192, maskable: false },
  { file: "public/icon-512.png", size: 512, maskable: false },
  { file: "public/icon-maskable-512.png", size: 512, maskable: true },
];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
for (const { file, size, maskable } of targets) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;padding:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg({ maskable })}`
  );
  const buf = await page.locator("svg").screenshot({ omitBackground: true });
  writeFileSync(file, buf);
  console.log(`${file}  ${size}x${size}${maskable ? "  (maskable)" : ""}  ${buf.length} bytes`);
}
await browser.close();
