import { describe, expect, it } from "vitest";
import { validateVerifyRequest } from "@/lib/autocount/verify-request";

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9XQAAAAASUVORK5CYII=";
const request = () => ({ mode: "verify", template: png, crops: [{ index: 0, image: png }] });

describe("AI crop request limits", () => {
  it("accepts numbered small PNGs", () => expect(validateVerifyRequest(request())).toBe(true));
  it("rejects excessive crops, duplicate IDs, fractional IDs and malformed images", () => {
    expect(validateVerifyRequest({ ...request(), crops: Array.from({ length: 13 }, (_, index) => ({ index, image: png })) })).toBe(false);
    expect(validateVerifyRequest({ ...request(), crops: [request().crops[0], request().crops[0]] })).toBe(false);
    expect(validateVerifyRequest({ ...request(), crops: [{ index: 0.1, image: png }] })).toBe(false);
    expect(validateVerifyRequest({ ...request(), template: "data:image/png;base64,invalid!" })).toBe(false);
    expect(validateVerifyRequest(null)).toBe(false);
  });
  it("rejects full drawing dimensions even when the encoded payload is small", () => {
    const bytes = Buffer.from(png.slice(22), "base64");
    bytes.writeUInt32BE(4096, 16);
    expect(validateVerifyRequest({ ...request(), template: `data:image/png;base64,${bytes.toString("base64")}` })).toBe(false);
  });
});
