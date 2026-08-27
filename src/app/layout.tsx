import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VOLTLINE — Estimating & Takeoff",
  description: "Electrical estimating and on-screen takeoff",
  // Named separately from the manifest's short_name: this is the window title,
  // that is the label under the taskbar icon.
  applicationName: "Voltline",
};

// Next 16 takes themeColor on the viewport export, not on metadata. It tints
// the installed window's chrome to match the app's own ground colour.
export const viewport: Viewport = {
  themeColor: "#0b0f14",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="h-screen overflow-hidden">{children}</body>
    </html>
  );
}
