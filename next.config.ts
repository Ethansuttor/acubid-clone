import type { NextConfig } from "next";

// Desktop build mode (track D1). `npm run desktop:build` sets this through a
// portable Node script (scripts/desktop/build.mjs); an ordinary `npm run build`
// never sets it, so the browser build keeps its previous configuration.
//
// In desktop mode Next.js emits `.next/standalone`: a minimal server.js plus
// only the traced node_modules it needs. The tracing root is pinned to this
// project so a checkout nested inside another package (a git worktree, a
// monorepo) cannot shift the standalone layout or pull in outside files.
const desktopBuild = process.env.VOLTLINE_BUILD_TARGET === "desktop";

const nextConfig: NextConfig = {
  // pdfjs-dist ships a worker as an ES module asset; keep it out of SSR bundling.
  serverExternalPackages: ["exceljs"],
  ...(desktopBuild
    ? {
        output: "standalone" as const,
        outputFileTracingRoot: __dirname,
        turbopack: { root: __dirname },
      }
    : {}),
};

export default nextConfig;
