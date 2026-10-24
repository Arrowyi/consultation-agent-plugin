import { describe, expect, test } from "bun:test"
import { MemoryError } from "@janus-agent/memory-core"
import { mapError } from "./errors.ts"

describe("mapError", () => {
  test("maps MemoryError to isError payload with code and message", () => {
    // given
    const error = new MemoryError("WRITER_LOCKED", "held by pid 1234")

    // when
    const result = mapError(error)

    // then
    expect(result.isError).toBe(true)
    expect(result.content).toHaveLength(1)
    expect(result.content[0]?.type).toBe("text")
    const parsed = JSON.parse(result.content[0]?.text ?? "{}")
    expect(parsed.code).toBe("WRITER_LOCKED")
    expect(parsed.message).toBe(error.message)
  })

  test("maps generic Error to isError with code INTERNAL", () => {
    // given
    const error = new Error("something broke")

    // when
    const result = mapError(error)

    // then
    expect(result.isError).toBe(true)
    const parsed = JSON.parse(result.content[0]?.text ?? "{}")
    expect(parsed.code).toBe("INTERNAL")
    expect(parsed.message).toBe("something broke")
  })

  test("maps non-Error value to isError with code INTERNAL", () => {
    // given
    const thrown = "string error"

    // when
    const result = mapError(thrown)

    // then
    expect(result.isError).toBe(true)
    const parsed = JSON.parse(result.content[0]?.text ?? "{}")
    expect(parsed.code).toBe("INTERNAL")
    expect(typeof parsed.message).toBe("string")
    expect(parsed.message.length).toBeGreaterThan(0)
  })

  test("sanitizes message by excluding stack traces", () => {
    // given
    const error = new Error("boom")
    error.stack = "Error: boom\n    at someInternalFile.ts:42:5\n    at secret.ts:1:1"

    // when
    const result = mapError(error)

    // then
    const parsed = JSON.parse(result.content[0]?.text ?? "{}")
    expect(parsed.message).toBe("boom")
    expect(parsed.message).not.toContain("at someInternalFile")
    expect(parsed.message).not.toContain("secret.ts")
  })

  test("caps excessively long messages", () => {
    // given
    const error = new Error("x".repeat(2000))

    // when
    const result = mapError(error)

    // then
    const parsed = JSON.parse(result.content[0]?.text ?? "{}")
    expect(parsed.message.length).toBeLessThanOrEqual(500)
  })
})
