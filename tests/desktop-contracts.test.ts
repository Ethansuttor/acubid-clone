// C1 desktop IPC contract. These are the checks the privileged process runs
// before it looks at a payload at all; a shape that gets past them is still
// revalidated by its handler.

import { describe, expect, it } from "vitest";
import {
  IPC_OPERATIONS,
  IPC_PROTOCOL_VERSION,
  isIpcRequest,
  type IpcOperation,
} from "../desktop/contracts";
import { PLATFORM_CONTRACT_VERSION } from "@/lib/platform/contracts";

function request(overrides: Record<string, unknown> = {}) {
  return {
    protocol: IPC_PROTOCOL_VERSION,
    requestId: "r1",
    operation: "storage.select" as IpcOperation,
    payload: { table: "projects", filters: [] },
    ...overrides,
  };
}

describe("IPC request gate", () => {
  it("accepts a well-formed request", () => {
    expect(isIpcRequest(request())).toBe(true);
  });

  it("refuses a request from a renderer built against another protocol", () => {
    expect(isIpcRequest(request({ protocol: IPC_PROTOCOL_VERSION + 1 }))).toBe(false);
    expect(isIpcRequest(request({ protocol: undefined }))).toBe(false);
  });

  it("refuses an unknown operation", () => {
    expect(isIpcRequest(request({ operation: "storage.dropEverything" }))).toBe(false);
    expect(isIpcRequest(request({ operation: "credential.get" }))).toBe(false);
  });

  it("refuses a missing or oversized request id", () => {
    expect(isIpcRequest(request({ requestId: "" }))).toBe(false);
    expect(isIpcRequest(request({ requestId: "x".repeat(65) }))).toBe(false);
  });

  it("refuses non-objects", () => {
    expect(isIpcRequest(null)).toBe(false);
    expect(isIpcRequest("storage.select")).toBe(false);
    expect(isIpcRequest(42)).toBe(false);
  });
});

describe("credential custody", () => {
  it("exposes no operation that reads a stored secret back out", () => {
    for (const operation of IPC_OPERATIONS) {
      expect(operation).not.toBe("credential.get");
      expect(operation).not.toBe("credential.read");
    }
    expect([...IPC_OPERATIONS].filter((op) => op.startsWith("credential.")).sort()).toEqual([
      "credential.clear",
      "credential.set",
      "credential.status",
    ]);
  });
});

describe("protocol versions", () => {
  it("moves with the platform contract version", () => {
    expect(IPC_PROTOCOL_VERSION).toBe(PLATFORM_CONTRACT_VERSION);
  });
});
