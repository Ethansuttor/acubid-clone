import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectOnCanvas } from "@/lib/autocount/pipeline";
import type { Detection } from "@/lib/autocount/types";

const worker = vi.hoisted(() => ({ init: vi.fn(), match: vi.fn(), close: vi.fn() }));
vi.mock("@/lib/autocount/worker-client", () => ({ createLocalMatcher: () => worker }));

// Control worker results and image encoding to test orchestration, not accuracy.
// Real pixel/worker accuracy is covered by autocount-local and phase4 E2E.
function canvas(width = 1000, height = 300, sameCrops = false): HTMLCanvasElement {
  let coordinates: number[] = [];
  return {
    width, height,
    getContext: () => ({
      getImageData: (_x: number, _y: number, w: number, h: number) => {
        const data = new Uint8ClampedArray(w * h * 4).fill(255);
        data[0] = data[1] = data[2] = 210; // faint linework on white
        return { data };
      },
      drawImage: (_source: unknown, ...args: number[]) => { coordinates = args; },
    }),
    toDataURL: () => `data:image/png;base64,${btoa(sameCrops ? "same" : JSON.stringify(coordinates))}`,
  } as unknown as HTMLCanvasElement;
}
const hit = (i: number, confidence = 0.8): Detection => ({ x: i % 25 * 38, y: Math.floor(i / 25) * 70, w: 20, h: 20, confidence });
const run = (assist = false, signal = new AbortController().signal, existing: { x: number; y: number }[] = []) =>
  detectOnCanvas(canvas(), canvas(20, 20), { minScore: 0.72, assist, existing }, signal, () => {});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("document", { createElement: () => canvas() });
  vi.stubGlobal("fetch", vi.fn());
  worker.init.mockResolvedValue(undefined);
  worker.match.mockResolvedValue([hit(0), hit(1)]);
});
afterEach(() => vi.unstubAllGlobals());

describe("local detection orchestration", () => {
  it("does not skip faint linework as a blank tile", async () => {
    const result = await run();
    expect(worker.match).toHaveBeenCalledOnce();
    expect(result.stats.skipped).toBe(0);
    expect(result.detections).toHaveLength(2);
  });
  it.each([0, 210, 255])("skips a uniform tile of any brightness (%i)", async brightness => {
    const source = canvas();
    source.getContext = (() => ({ getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4).fill(brightness) }) })) as unknown as typeof source.getContext;
    const result = await detectOnCanvas(source, canvas(20, 20), { minScore: 0.72, assist: false, existing: [] }, new AbortController().signal, () => {});
    expect(result.stats.skipped).toBe(1);
    expect(result.detections).toEqual([]);
    expect(worker.match).not.toHaveBeenCalled();
  });
  it("does not send images in local mode and suppresses existing marks", async () => {
    const result = await run(false, undefined, [{ x: 10, y: 10 }]);
    expect(result.detections).toEqual([{ ...hit(1), review: "local" }]);
    expect(result.stats.duplicates).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(worker.close).toHaveBeenCalledOnce();
  });
  it("sends nothing when assisted matches are already strong", async () => {
    worker.match.mockResolvedValue([hit(0, 0.99)]);
    expect((await run(true)).stats.requests).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("retains every local candidate on optional API failure without retries", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("unavailable", { status: 503 }));
    const result = await run(true);
    expect(result.detections).toHaveLength(2);
    expect(result.detections.every(d => d.review === "unresolved")).toBe(true);
    expect(result.warning).toContain("All local candidates");
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("keeps negative and malformed AI decisions for human review", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ verifications: [
      { index: 0, match: false, confidence: 0.99 },
      { index: 1, match: "true", confidence: 0.99 },
      { index: 999, match: true, confidence: 0.99 },
    ] }));
    const result = await run(true);
    expect(result.detections.map(d => d.review)).toEqual(["no-match", "unresolved"]);
  });
  it("caps work at four requests of twelve small crops and retains overflow locally", async () => {
    worker.match.mockResolvedValue(Array.from({ length: 60 }, (_, i) => hit(i)));
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      const body = JSON.parse(init!.body as string);
      expect(body.crops).toHaveLength(12);
      expect(body.tiles).toBeUndefined();
      return Response.json({ verifications: body.crops.map((crop: { index: number }) => ({ index: crop.index, match: true, confidence: 0.9 })) });
    });
    const result = await run(true);
    expect(result.stats.requests).toBe(4);
    expect(result.stats.sentCrops).toBe(48);
    expect(result.detections.filter(d => d.review === "match")).toHaveLength(48);
    expect(result.detections.filter(d => d.review === "local")).toHaveLength(12);
  });
  it("reuses identical crop decisions within a run", async () => {
    vi.stubGlobal("document", { createElement: () => canvas(1000, 300, true) });
    vi.mocked(fetch).mockResolvedValue(Response.json({ verifications: [{ index: 0, match: true, confidence: 1 }] }));
    const result = await run(true);
    expect(result.stats.sentCrops).toBe(1);
    expect(result.detections.map(d => d.review)).toEqual(["match", "match"]);
  });
  it("aborts without returning partial results and closes the worker", async () => {
    const controller = new AbortController();
    worker.match.mockImplementation(async () => { controller.abort(); return [hit(0)]; });
    await expect(run(false, controller.signal)).rejects.toThrow();
    expect(worker.close).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });
});
