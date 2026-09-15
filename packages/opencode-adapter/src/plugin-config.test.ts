import { describe, expect, it } from "bun:test"

import {
  COST_GUARD_USD_DEFAULT,
  ConsultationPluginConfigSchema,
  TEAM_CAPS_DEFAULTS,
  TIER_ROLE_CAPS_DEFAULTS,
  resolveCostGuardUsd,
  resolveTeamCaps,
  resolveTierRoleCaps,
  type ConsultationPluginConfig,
} from "./plugin-config.ts"

function config(overrides: Partial<ConsultationPluginConfig> = {}): ConsultationPluginConfig {
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
    expect(resolveTierRoleCaps(cfg).standard).toEqual({ explorer: 5, analyst: 2, critic: 1, verifier: 1 })
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
