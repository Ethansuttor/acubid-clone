import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs-dist ships a worker as an ES module asset; keep it out of SSR bundling.
  serverExternalPackages: ["exceljs"],
};

export default nextConfig;
