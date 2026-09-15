import { describe, expect, it } from "bun:test";
import { MemoryError, MemoryErrorCodes, type MemoryErrorCode } from "./errors.ts";

describe("MemoryError", () => {
  it("carries the stable code on the instance", () => {
    // given
    const code: MemoryErrorCode = "NOT_FOUND";

    // when
    const error = new MemoryError(code, "missing item abc");

    // then
    expect(error.code).toBe("NOT_FOUND");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("MemoryError");
  });

  it("includes the code in the message", () => {
    // given // when
    const error = new MemoryError("ILLEGAL_TRANSITION", "active -> active");

    // then
    expect(error.message).toContain("ILLEGAL_TRANSITION");
    expect(error.message).toContain("active -> active");
  });

  it("exposes every code from the plan contract", () => {
    // given // when // then
    expect(MemoryErrorCodes).toEqual([
      "WRITER_LOCKED",
      "NOT_FOUND",
      "ILLEGAL_TRANSITION",
      "IDEMPOTENCY_MISMATCH",
      "SENSITIVE_UNCONFIRMED",
      "SECRET_DETECTED",
      "VALIDATION_FAILED",
      "STORE_CLOSED",
    ]);
  });
});
