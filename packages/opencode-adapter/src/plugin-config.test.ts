import { describe, expect, it } from "bun:test"
import { z } from "zod"

import {
  COST_GUARD_USD_DEFAULT,
  ConsultationPluginConfigSchema,
  TEAM_CAPS_DEFAULTS,
  TIER_ROLE_CAPS_DEFAULTS,
  resolveCostGuardUsd,
  resolveRoleModel,
  resolveRoleModelChain,
  resolveTeamCaps,
  resolveTierRoleCaps,
  stripJsonc,
  type ConsultationPluginConfig,
} from "./plugin-config.ts"

// Typed as the schema *input*: parse is the boundary, so legacy matrices
// without `writer` must stay expressible here and get defaulted by parse.
function config(overrides: z.input<typeof ConsultationPluginConfigSchema> = {}): ConsultationPluginConfig {
  return ConsultationPluginConfigSchema.parse(overrides)
}

describe("resolveTeamCaps", () => {
  it("returns defaults when team_caps is unset", () => {
    // given // when // then
    expect(resolveTeamCaps(config())).toEqual(TEAM_CAPS_DEFAULTS)
  })

  it("overrides individual caps", () => {
    // given
    const cfg = config({ team_caps: { round_cap: 2, explorer_cap: 8, critic_search_cap: 6 } })

    // when // then
    expect(resolveTeamCaps(cfg)).toEqual({ round_cap: 2, explorer_cap: 8, critic_search_cap: 6 })
  })
})

describe("resolveTierRoleCaps", () => {
  it("returns defaults when tier_role_caps is unset", () => {
    // given // when // then
    expect(resolveTierRoleCaps(config())).toEqual(TIER_ROLE_CAPS_DEFAULTS)
  })

  it("overrides individual tiers", () => {
    // given
    const cfg = config({
      tier_role_caps: {
        fast: { explorer: 5, analyst: 0, critic: 0, verifier: 0 },
        standard: { explorer: 5, analyst: 2, critic: 1, verifier: 1 },
        deep: { explorer: 5, analyst: 3, critic: 2, verifier: 2 },
      },
    })

    // when // then
    expect(resolveTierRoleCaps(cfg).standard).toEqual({ explorer: 5, analyst: 2, critic: 1, verifier: 1, writer: 0 })
  })
})

describe("resolveCostGuardUsd", () => {
  it("returns the default when unset and the override when set", () => {
    // given // when // then
    expect(resolveCostGuardUsd(config())).toBe(COST_GUARD_USD_DEFAULT)
    expect(resolveCostGuardUsd(config({ cost_guard_provider_usd: 7 }))).toBe(7)
  })
})

describe("ConsultationPluginConfigSchema", () => {
  it("rejects negative role caps and non-positive caps", () => {
    // given // when // then
    expect(() => config({ tier_role_caps: { fast: { explorer: -1, analyst: 0, critic: 0, verifier: 0 }, standard: { explorer: 5, analyst: 1, critic: 1, verifier: 1 }, deep: { explorer: 5, analyst: 3, critic: 2, verifier: 2 } } })).toThrow()
    expect(() => config({ team_caps: { round_cap: 0, explorer_cap: 5, critic_search_cap: 5 } })).toThrow()
  })
})

describe("writer role configuration", () => {
  it("defaults the packaged writer role", () => {
    // given // when
    const cfg = config()

    // then
    expect(cfg.writer_agent).toBe("consultation-writer")
    expect(cfg.writer_enabled).toBe(true)
    expect(resolveRoleModel(cfg, "writer")).toBe("opencode/claude-sonnet-5")
    expect(resolveRoleModelChain(cfg, "writer")).toEqual(["opencode/claude-sonnet-5", "moonshotai-cn/kimi-k3"])
    expect(cfg.writer_delegate_agent).toBeUndefined()
    expect(cfg.writer_delegate_model).toBeUndefined()
    expect(resolveTierRoleCaps(cfg).standard.writer).toBe(1)
    expect(resolveTierRoleCaps(cfg).deep.writer).toBe(2)
  })

  it("overrides the writer model when writer_model is set", () => {
    // given
    const cfg = config({ writer_model: "anthropic/claude-opus-4-6" })

    // when // then
    expect(resolveRoleModel(cfg, "writer")).toBe("anthropic/claude-opus-4-6")
    expect(resolveRoleModelChain(cfg, "writer")).toEqual(["anthropic/claude-opus-4-6", "moonshotai-cn/kimi-k3"])
  })

  it("honors a configured fallback chain", () => {
    // given
    const cfg = config({ writer_fallback_models: ["a/b", "c/d"] })

    // when // then
    expect(resolveRoleModelChain(cfg, "writer")).toEqual(["opencode/claude-sonnet-5", "a/b", "c/d"])
  })

  it("keeps non-writer roles on a single-model chain", () => {
    // given // when // then
    expect(resolveRoleModelChain(config(), "critic")).toEqual(["opencode-go/glm-5.2"])
    expect(resolveRoleModelChain(config(), "explorer")).toEqual(["deepseek/deepseek-flash"])
  })

  it("accepts writer delegate fields", () => {
    // given
    const cfg = config({ writer_delegate_agent: "host-writer", writer_delegate_model: "p/m" })

    // when // then
    expect(cfg.writer_delegate_agent).toBe("host-writer")
    expect(cfg.writer_delegate_model).toBe("p/m")
  })

  it("accepts a legacy custom role-cap matrix without writer", () => {
    // given
    const cfg = config({
      tier_role_caps: {
        fast: { explorer: 1, analyst: 0, critic: 0, verifier: 0 },
        standard: { explorer: 2, analyst: 1, critic: 1, verifier: 1 },
        deep: { explorer: 3, analyst: 2, critic: 2, verifier: 1 },
      },
    })

    // when // then
    expect(resolveTierRoleCaps(cfg).standard.writer).toBe(0)
    expect(resolveTierRoleCaps(cfg).fast.writer).toBe(0)
    expect(resolveTierRoleCaps(cfg).deep.writer).toBe(0)
  })
})

describe("stripJsonc", () => {
  it("strips line and block comments so JSON.parse succeeds", () => {
    // given
    const input = '{\n  // line note\n  "a": 1,\n  /* block\n     note */\n  "b": [1, 2]\n}'

    // when
    const parsed = JSON.parse(stripJsonc(input))

    // then
    expect(parsed).toEqual({ a: 1, b: [1, 2] })
  })

  it("strips trailing commas in objects and arrays", () => {
    // given
    const input = '{"a": [1, 2,], "b": {"c": 3,},}'

    // when
    const parsed = JSON.parse(stripJsonc(input))

    // then
    expect(parsed).toEqual({ a: [1, 2], b: { c: 3 } })
  })

  it("catches a trailing comma separated from the closing brace by a comment", () => {
    // given
    const input = '{\n  "a": 1, // why\n}'

    // when
    const parsed = JSON.parse(stripJsonc(input))

    // then
    expect(parsed).toEqual({ a: 1 })
  })

  it("preserves comment-like and comma-like sequences inside strings", () => {
    // given — raw text: {"u": "http://a//b", "c": "/* not a comment */",
    // "q": "she said \" // hi", "p": "C:\\", "t": "[1,]"}
    const input = '{"u": "http://a//b", "c": "/* not a comment */", "q": "she said \\" // hi", "p": "C:\\\\", "t": "[1,]"}'

    // when // then
    expect(stripJsonc(input)).toBe(input)
    expect(JSON.parse(input)).toEqual({ u: "http://a//b", c: "/* not a comment */", q: 'she said " // hi', p: "C:\\", t: "[1,]" })
  })
})
