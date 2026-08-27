// Web app manifest: what Edge/Chrome read when the estimator picks
// "Install this site as an app", so Voltline gets its own window, a Start-menu
// entry and a taskbar icon instead of living in a browser tab.
//
// Deliberately no service worker. Offline caching would let an installed
// window run yesterday's estimating code against today's bid, and this app is
// used on live bids — see `.ai/05-decisions.md`. Installability does not
// require one.

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Voltline — Estimating & Takeoff",
    short_name: "Voltline",
    description: "Electrical estimating and on-screen takeoff",
    start_url: "/",
    scope: "/",
    display: "standalone",
    // The app's own ground colour, so the window chrome and the launch splash
    // match the UI instead of flashing white.
    background_color: "#0b0f14",
    theme_color: "#0b0f14",
    categories: ["business", "productivity", "utilities"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
