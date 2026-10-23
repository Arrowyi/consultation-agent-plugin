import { describe, expect, it } from "bun:test"
import {
  buildChainFailureMessage,
  embedsProviderErrorText,
  isProviderErrorText,
  modelFailureHint,
  observationToOutcome,
} from "./dispatch-helpers.ts"

describe("isProviderErrorText", () => {
  it("recognizes provider error names and rejects the unrecognized fallback", () => {
    expect(isProviderErrorText("APIError: 402")).toBe(true)
    expect(isProviderErrorText("ProviderAuthError: 401")).toBe(true)
    expect(isProviderErrorText("unrecognized provider error")).toBe(false)
  })
})

describe("embedsProviderErrorText", () => {
  it("matches a provider error embedded in wrapper text and rejects plain wrappers", () => {
    expect(embedsProviderErrorText("promptAsync failed: UnknownError: 404")).toBe(true)
    expect(embedsProviderErrorText("promptAsync failed: APIError: 402")).toBe(true)
    expect(embedsProviderErrorText("promptAsync failed: unrecognized provider error")).toBe(false)
    expect(embedsProviderErrorText("failed to persist attempt reservation: journal write was rejected by host")).toBe(false)
    expect(embedsProviderErrorText("UnknownError: 404")).toBe(false)
  })
})

describe("modelFailureHint", () => {
  it("names the model and the config override field", () => {
    const hint = modelFailureHint("explorer", "opencode-go/deepseek-v4.1-flash")
    expect(hint).toContain("(model: opencode-go/deepseek-v4.1-flash)")
    expect(hint).toContain('set "explorer_model"')
    expect(hint).toContain("~/.config/consultation-agent/config.jsonc")
    expect(hint).toContain("$CONSULTATION_CONFIG")
  })

  it("maps hyphenated roles to their underscored config fields", () => {
    expect(modelFailureHint("build-lite", "opencode-go/glm-5.3-flash")).toContain('set "build_lite_model"')
    expect(modelFailureHint("build", null)).toContain('set "build_model"')
  })

  it("omits the model label when the model is null", () => {
    expect(modelFailureHint("simple", null)).not.toContain("(model:")
  })
})

describe("observationToOutcome failure hint", () => {
  it("appends the hint to provider-error failures", () => {
    const outcome = observationToOutcome(
      { kind: "failed", error: "APIError: 402", retryable: false },
      "ses_job",
      "explorer",
      { index: 0, model: "opencode-go/deepseek-v4.1-flash", sessionID: "ses_child" },
      100,
    )
    expect(outcome.kind).toBe("failure")
    if (outcome.kind === "failure") {
      expect(outcome.reason).toContain("explorer dispatch failed: APIError: 402")
      expect(outcome.reason).toContain("(model: opencode-go/deepseek-v4.1-flash)")
      expect(outcome.reason).toContain('set "explorer_model"')
    }
  })

  it("does not append the hint to non-provider failures", () => {
    const outcome = observationToOutcome(
      { kind: "failed", error: "unrecognized provider error", retryable: false },
      "ses_job",
      "analyst",
      { index: 0, model: "opencode-go/qwen3.8-max", sessionID: "ses_child" },
      100,
    )
    expect(outcome.kind).toBe("failure")
    if (outcome.kind === "failure") {
      expect(outcome.reason).toBe("analyst dispatch failed: unrecognized provider error")
    }
  })
})

describe("buildChainFailureMessage hint", () => {
  it("carries the hint for provider errors", () => {
    const message = buildChainFailureMessage("writer", ["opencode/claude-sonnet-5-5", "opencode-go/glm-5.3"], "APIError: 402")
    expect(message).toContain("failed on every model in the chain")
    expect(message).toContain('set "writer_model"')
    expect(message).toContain("degrade by answering inline")
  })

  it("stays unchanged for non-provider errors", () => {
    const message = buildChainFailureMessage("writer", ["opencode/claude-sonnet-5-5"], "unrecognized provider error")
    expect(message).not.toContain("Hint:")
  })
})
