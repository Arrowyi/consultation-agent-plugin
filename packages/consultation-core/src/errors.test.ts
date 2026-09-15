import { describe, expect, it } from "bun:test";
import { ConsultationError } from "./errors";

describe("ConsultationError", () => {
  it("carries a stable code string and message", () => {
    // given
    // when
    const err = new ConsultationError("BUDGET_EXCEEDED", "no searches left");
    // then
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("BUDGET_EXCEEDED");
    expect(err.message).toBe("no searches left");
    expect(err.name).toBe("ConsultationError");
  });

  it("defaults message to the code when none is provided", () => {
    // given
    // when
    const err = new ConsultationError("NUMERIC_CONFIDENCE");
    // then
    expect(err.message).toBe("NUMERIC_CONFIDENCE");
    expect(err.code).toBe("NUMERIC_CONFIDENCE");
  });
});
