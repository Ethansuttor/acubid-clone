// C1 AI seam: bounds are enforced before anything is spent, and every failure
// mode leaves candidates in the caller's hands rather than silently resolved.

import { describe, expect, it } from "vitest";
import { AI_LIMITS, checkVerifyRequest, setAiTransport, aiTransport } from "@/lib/platform/ai";
import { createFakeAiTransport } from "@/lib/platform/fake-ai";

const PNG = "data:image/png;base64,";

function crops(count: number, from = 0) {
  return Array.from({ length: count }, (_, index) => ({
    index: from + index,
    image: `${PNG}crop${from + index}`,
  }));
}

describe("verification request bounds", () => {
  it("accepts a request at the documented limit", () => {
    expect(
      checkVerifyRequest({ template: `${PNG}t`, crops: crops(AI_LIMITS.maxCropsPerRequest) })
    ).toBeNull();
  });

  it("rejects more crops than one request allows", () => {
    const problem = checkVerifyRequest({
      template: `${PNG}t`,
      crops: crops(AI_LIMITS.maxCropsPerRequest + 1),
    });
    expect(problem?.code).toBe("too-large");
  });

  it("rejects duplicate candidate numbers", () => {
    const problem = checkVerifyRequest({
      template: `${PNG}t`,
      crops: [
        { index: 3, image: `${PNG}a` },
        { index: 3, image: `${PNG}b` },
      ],
    });
    expect(problem?.code).toBe("invalid-input");
  });

  it("rejects a non-PNG template or crop", () => {
    expect(checkVerifyRequest({ template: "https://example/x.png", crops: crops(1) })?.code).toBe(
      "invalid-input"
    );
    expect(
      checkVerifyRequest({
        template: `${PNG}t`,
        crops: [{ index: 0, image: "data:image/jpeg;base64,x" }],
      })?.code
    ).toBe("invalid-input");
  });
});

describe("fake AI transport semantics", () => {
  it("answers only for the crops it decided, leaving the rest undecided", async () => {
    const transport = createFakeAiTransport({ decisions: { 0: { match: true, confidence: 0.9 } } });
    const result = await transport.verifyCrops({ template: `${PNG}t`, crops: crops(3) });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.verifications.map((v) => v.index)).toEqual([0]);
    }
  });

  it("spends nothing when the request is out of bounds", async () => {
    const transport = createFakeAiTransport();
    const result = await transport.verifyCrops({
      template: `${PNG}t`,
      crops: crops(AI_LIMITS.maxCropsPerRequest + 1),
    });
    expect(result.ok).toBe(false);
    expect(transport.calls).toHaveLength(0);
  });

  it("reports a closed route as unauthorized, not as an outage", async () => {
    const transport = createFakeAiTransport({
      failWith: { code: "unauthorized", message: "AI review is not enabled." },
    });
    const result = await transport.verifyCrops({ template: `${PNG}t`, crops: crops(1) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unauthorized");
  });

  it("reports cancellation as aborted rather than a failure", async () => {
    const transport = createFakeAiTransport({ hang: true });
    const controller = new AbortController();
    const pending = transport.verifyCrops(
      { template: `${PNG}t`, crops: crops(1) },
      { signal: controller.signal }
    );
    controller.abort();
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("aborted");
  });
});

describe("transport registration", () => {
  it("defaults to no transport, so callers stay local-only", () => {
    setAiTransport(null);
    expect(aiTransport()).toBeNull();
  });

  it("returns the registered transport", () => {
    const transport = createFakeAiTransport();
    setAiTransport(transport);
    expect(aiTransport()).toBe(transport);
    setAiTransport(null);
  });
});
