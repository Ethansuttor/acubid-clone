import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Voltline Electrical Estimating",
  description: "Electrical estimating and on-screen takeoff",
  // The installed window's title; the manifest's short_name labels the icon.
  applicationName: "Voltline",
};

// Next 16 takes themeColor on the viewport export, not on metadata. It tints
// the installed window's chrome to match the app's ground colour.
export const viewport: Viewport = {
  themeColor: "#f3f5f7",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="h-screen overflow-hidden">{children}</body>
    </html>
  );
}
