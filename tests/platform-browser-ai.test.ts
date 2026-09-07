// The web-route AI transport. `fetch` is stubbed so no request leaves the
// machine and no paid call is possible; what is under test is the transport's
// own behavior: bounds enforced before anything is sent, HTTP status mapped to
// contract codes, malformed decisions dropped rather than trusted, and
// cancellation reported as a cancellation.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserAiTransport } from "@/lib/platform/browser-ai";
import { AI_LIMITS } from "@/lib/platform/ai";

const PNG = "data:image/png;base64,";

function crops(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    index,
    image: `${PNG}crop${index}`,
  }));
}

interface StubbedCall {
  url: string;
  body: unknown;
  authorization: string;
}

let calls: StubbedCall[] = [];

function respond(status: number, payload: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        url,
        body: JSON.parse(String(init.body)),
        authorization: String((init.headers as Record<string, string>).authorization),
      });
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => payload,
      } as Response;
    })
  );
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("verifyCrops over the web route", () => {
  it("sends the verify request with the caller's authorization and returns decisions", async () => {
    respond(200, {
      verifications: [{ index: 0, match: true, confidence: 0.91 }],
      model: "claude-sonnet-4-6",
    });
    const result = await createBrowserAiTransport("Bearer local").verifyCrops({
      template: `${PNG}t`,
      crops: crops(1),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.model).toBe("claude-sonnet-4-6");
      expect(result.value.verifications).toEqual([{ index: 0, match: true, confidence: 0.91 }]);
    }
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/autocount");
    expect(calls[0].authorization).toBe("Bearer local");
    expect(calls[0].body).toMatchObject({ mode: "verify" });
  });

  it("refuses an over-limit batch without issuing a request", async () => {
    respond(200, { verifications: [] });
    const result = await createBrowserAiTransport("Bearer local").verifyCrops({
      template: `${PNG}t`,
      crops: crops(AI_LIMITS.maxCropsPerRequest + 1),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("too-large");
    expect(calls).toHaveLength(0);
  });

  it("drops decisions for crops that were never sent", async () => {
    respond(200, {
      verifications: [
        { index: 0, match: true, confidence: 0.9 },
        { index: 99, match: true, confidence: 1 },
      ],
      model: "m",
    });
    const result = await createBrowserAiTransport("").verifyCrops({
      template: `${PNG}t`,
      crops: crops(2),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.verifications.map((v) => v.index)).toEqual([0]);
  });

  it("drops a malformed decision rather than treating it as a match", async () => {
    respond(200, {
      verifications: [
        { index: 0, match: "yes", confidence: 0.9 },
        { index: 1, match: true, confidence: 4 },
      ],
      model: "m",
    });
    const result = await createBrowserAiTransport("").verifyCrops({
      template: `${PNG}t`,
      crops: crops(2),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.verifications).toEqual([]);
  });

  it("survives a response with no verifications at all", async () => {
    respond(200, {});
    const result = await createBrowserAiTransport("").verifyCrops({
      template: `${PNG}t`,
      crops: crops(1),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.verifications).toEqual([]);
      expect(result.value.model).toBe("AI review");
    }
  });

  it("reports a closed production route as unauthorized", async () => {
    respond(401, { error: "Unauthorized" });
    const result = await createBrowserAiTransport("").verifyCrops({
      template: `${PNG}t`,
      crops: crops(1),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unauthorized");
  });

  it("reports a missing provider key as unavailable and keeps the explanation", async () => {
    respond(503, { error: "ANTHROPIC_API_KEY is not configured on the server." });
    const result = await createBrowserAiTransport("").verifyCrops({
      template: `${PNG}t`,
      crops: crops(1),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("unavailable");
      expect(result.error.message).toMatch(/ANTHROPIC_API_KEY/);
    }
  });

  it("maps a server-side rejection and a provider failure to distinct codes", async () => {
    respond(400, { error: "Use at most 12 unique numbered PNG crops" });
    const rejected = await createBrowserAiTransport("").verifyCrops({
      template: `${PNG}t`,
      crops: crops(1),
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error.code).toBe("invalid-input");

    respond(502, { error: "Verification failed: provider timeout" });
    const failed = await createBrowserAiTransport("").verifyCrops({
      template: `${PNG}t`,
      crops: crops(1),
    });
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.code).toBe("io-failed");
  });

  it("reports an aborted request as cancelled, not as a failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        await new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError"))
          );
        });
        throw new Error("unreachable");
      })
    );
    const controller = new AbortController();
    const pending = createBrowserAiTransport("").verifyCrops(
      { template: `${PNG}t`, crops: crops(1) },
      { signal: controller.signal }
    );
    controller.abort();
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("aborted");
  });

  it("reports a network failure without inventing decisions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );
    const result = await createBrowserAiTransport("").verifyCrops({
      template: `${PNG}t`,
      crops: crops(1),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("io-failed");
  });
});

describe("analyzeSheets over the web route", () => {
  it("returns proposals from the sheet-analysis route", async () => {
    respond(200, {
      proposals: [
        {
          id: "s1",
          sheetNumber: "E-101",
          sheetTitle: "POWER PLAN",
          scaleText: '1/4" = 1\'-0"',
          confidence: 0.8,
          feetPerInch: 4,
        },
      ],
      model: "claude-sonnet-4-6",
    });
    const result = await createBrowserAiTransport("Bearer local").analyzeSheets({
      sheets: [{ id: "s1", image: `${PNG}sheet` }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.proposals[0].sheetNumber).toBe("E-101");
      expect(result.value.proposals[0].feetPerInch).toBe(4);
    }
    expect(calls[0].url).toBe("/api/sheetinfo");
  });

  it("refuses an empty or over-limit sheet batch without issuing a request", async () => {
    respond(200, { proposals: [] });
    const transport = createBrowserAiTransport("");
    const empty = await transport.analyzeSheets({ sheets: [] });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.code).toBe("invalid-input");

    const tooMany = await transport.analyzeSheets({
      sheets: Array.from({ length: AI_LIMITS.maxSheetsPerRequest + 1 }, (_, index) => ({
        id: `s${index}`,
        image: `${PNG}sheet`,
      })),
    });
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.error.code).toBe("too-large");
    expect(calls).toHaveLength(0);
  });

  it("treats a response without a proposal list as a failure", async () => {
    respond(200, { model: "m" });
    const result = await createBrowserAiTransport("").analyzeSheets({
      sheets: [{ id: "s1", image: `${PNG}sheet` }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("io-failed");
  });
});
