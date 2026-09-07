// AI_LIMITS is a copy of bounds that are really enforced elsewhere: by
// validateVerifyRequest on the server, and by literals inside the two API
// routes. A copy that drifts is worse than no copy — the client would send a
// batch the server rejects, or stop sending one the server would accept.
//
// These tests pin the copy to the enforcing code. Where the bound is an
// exported function, they exercise it; where it is a literal inside a route
// that cannot be imported outside the Next.js server runtime, they assert the
// literal is still present in that route's source and say so.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AI_LIMITS, checkVerifyRequest } from "@/lib/platform/ai";
import { validateVerifyRequest } from "@/lib/autocount/verify-request";
import { MAX_AI_CROPS, AI_BATCH_SIZE } from "@/lib/autocount/local";

/**
 * A PNG the validator will accept: it only reads the 8-byte signature and the
 * IHDR width/height, so a header with no pixel data is enough and no image
 * encoder is needed.
 */
function pngOf(width: number, height: number): string {
  const bytes = Buffer.alloc(26);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

function verifyRequest(cropCount: number, edge = 32) {
  return {
    mode: "verify" as const,
    template: pngOf(32, 32),
    crops: Array.from({ length: cropCount }, (_, index) => ({
      index,
      image: pngOf(edge, edge),
    })),
  };
}

describe("the PNG helper matches what the validator actually checks", () => {
  it("produces a request the server validator accepts", () => {
    expect(validateVerifyRequest(verifyRequest(1))).toBe(true);
  });
});

describe("crops per request", () => {
  it("server and client agree at the limit", () => {
    const atLimit = verifyRequest(AI_LIMITS.maxCropsPerRequest);
    expect(validateVerifyRequest(atLimit)).toBe(true);
    expect(checkVerifyRequest(atLimit)).toBeNull();
  });

  it("server and client agree one past the limit", () => {
    const overLimit = verifyRequest(AI_LIMITS.maxCropsPerRequest + 1);
    expect(validateVerifyRequest(overLimit)).toBe(false);
    expect(checkVerifyRequest(overLimit)?.code).toBe("too-large");
  });

  it("matches the batch size the detection pipeline actually sends", () => {
    expect(AI_LIMITS.maxCropsPerRequest).toBe(AI_BATCH_SIZE);
  });
});

describe("crop size", () => {
  it("accepts a crop at the documented maximum edge", () => {
    expect(validateVerifyRequest(verifyRequest(1, AI_LIMITS.maxCropEdge))).toBe(true);
  });

  it("rejects a crop one pixel over it", () => {
    expect(validateVerifyRequest(verifyRequest(1, AI_LIMITS.maxCropEdge + 1))).toBe(false);
  });
});

describe("candidates per detection run", () => {
  it("matches the pipeline's own ceiling", () => {
    expect(AI_LIMITS.maxCandidatesPerRun).toBe(MAX_AI_CROPS);
  });

  it("is a whole number of requests, so no batch is silently dropped", () => {
    expect(AI_LIMITS.maxCandidatesPerRun % AI_LIMITS.maxCropsPerRequest).toBe(0);
  });
});

// These two bounds live as literals inside route handlers, which import
// `next/server` and cannot be loaded here. Asserting on the source is the
// honest way to catch drift without pretending the route was executed.
describe("bounds that are literals inside the API routes", () => {
  it("the auto-count route still caps a verification body at the documented size", () => {
    const source = readFileSync("src/app/api/autocount/route.ts", "utf8");
    expect(source).toContain("raw.length > 2 * 1024 * 1024");
    expect(AI_LIMITS.maxVerifyRequestBytes).toBe(2 * 1024 * 1024);
  });

  it("the sheet-analysis route still caps a batch at the documented sheet count", () => {
    const source = readFileSync("src/app/api/sheetinfo/route.ts", "utf8");
    expect(source).toMatch(
      new RegExp(`const MAX_SHEETS = ${AI_LIMITS.maxSheetsPerRequest}\\b`)
    );
  });

  it("both routes still fail closed in production", () => {
    for (const route of ["src/app/api/autocount/route.ts", "src/app/api/sheetinfo/route.ts"]) {
      const source = readFileSync(route, "utf8");
      expect(source).toContain('process.env.NODE_ENV === "production"');
      expect(source).toContain("return false");
    }
  });
});
