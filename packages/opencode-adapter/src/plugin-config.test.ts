import { describe, expect, it } from "bun:test"
import { z } from "zod"

import {
  COST_GUARD_USD_DEFAULT,
  JanusPluginConfigSchema,
  TEAM_CAPS_DEFAULTS,
  TIER_ROLE_CAPS_DEFAULTS,
  resolveCostGuardUsd,
  resolveRoleModel,
  resolveRoleModelChain,
  resolveTeamCaps,
  resolveTierRoleCaps,
  stripJsonc,
  type JanusPluginConfig,
} from "./plugin-config.ts"

// Typed as the schema *input*: parse is the boundary, so partial tier matrices
// without `writer` are expressible and defaulted by parse.
function config(overrides: z.input<typeof JanusPluginConfigSchema> = {}): JanusPluginConfig {
  return JanusPluginConfigSchema.parse(overrides)
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

describe("JanusPluginConfigSchema", () => {
  it("rejects negative role caps and non-positive caps", () => {
    // given // when // then
    expect(() => config({ tier_role_caps: { fast: { explorer: -1, analyst: 0, critic: 0, verifier: 0 }, standard: { explorer: 5, analyst: 1, critic: 1, verifier: 1 }, deep: { explorer: 5, analyst: 3, critic: 2, verifier: 2 } } })).toThrow()
    expect(() => config({ team_caps: { round_cap: 0, explorer_cap: 5, critic_search_cap: 5 } })).toThrow()
  })
})

describe("model defaults sync (decision 20)", () => {
  it("resolves the synced defaults per role", () => {
    // given // when // then
    expect(resolveRoleModel(config(), "consultant")).toBe("opencode-go/glm-5.3")
    expect(resolveRoleModel(config(), "critic")).toBe("opencode/gemini-3.8-flash")
    expect(resolveRoleModel(config(), "verifier")).toBe("opencode/gemini-3.8-flash")
    expect(resolveRoleModel(config(), "writer")).toBe("opencode/claude-sonnet-5-5")
  })

  it("collapses every role to a single-model chain", () => {
    // given // when // then
    expect(resolveRoleModelChain(config(), "writer")).toEqual(["opencode/claude-sonnet-5-5"])
    expect(resolveRoleModelChain(config(), "critic")).toEqual(["opencode/gemini-3.8-flash"])
    expect(resolveRoleModelChain(config(), "explorer")).toEqual(["opencode-go/deepseek-v4.1-flash"])
  })
})

describe("writer role configuration", () => {
  it("defaults the packaged writer role", () => {
    // given // when
    const cfg = config()

    // then
    expect(cfg.writer_agent).toBe("consultation-writer")
    expect(cfg.writer_enabled).toBe(true)
    expect(resolveRoleModel(cfg, "writer")).toBe("opencode/claude-sonnet-5-5")
    expect(resolveRoleModelChain(cfg, "writer")).toEqual(["opencode/claude-sonnet-5-5"])
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
    expect(resolveRoleModelChain(cfg, "writer")).toEqual(["anthropic/claude-opus-4-6"])
  })

  it("keeps non-writer roles on a single-model chain", () => {
    // given // when // then
    expect(resolveRoleModelChain(config(), "critic")).toEqual(["opencode/gemini-3.8-flash"])
    expect(resolveRoleModelChain(config(), "explorer")).toEqual(["opencode-go/deepseek-v4.1-flash"])
  })

  it("accepts writer delegate fields", () => {
    // given
    const cfg = config({ writer_delegate_agent: "host-writer", writer_delegate_model: "p/m" })

    // when // then
    expect(cfg.writer_delegate_agent).toBe("host-writer")
    expect(cfg.writer_delegate_model).toBe("p/m")
  })

  it("defaults writer to 0 when a tier matrix omits it", () => {
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

describe("lite, coder, and coder-lite role configuration", () => {
  it("defaults the lite and coder roles and resolves their models", () => {
    // given
    const cfg = config()

    // when // then
    expect(cfg.lite_agent).toBe("lite")
    expect(cfg.lite_enabled).toBe(true)
    expect(cfg.lite_model).toBeUndefined()
    expect(cfg.lite_workspace_dir).toBeUndefined()
    expect(resolveRoleModel(cfg, "lite")).toBe("opencode-go/deepseek-v4.1-flash")
    expect(resolveRoleModelChain(cfg, "lite")).toEqual(["opencode-go/deepseek-v4.1-flash"])
    expect(cfg.coder_agent).toBe("coder")
    expect(cfg.coder_enabled).toBe(true)
    expect(resolveRoleModel(cfg, "coder")).toBe("opencode-go/glm-5.3")
    expect(cfg.coder_lite_agent).toBe("coder-lite")
    expect(cfg.coder_lite_enabled).toBe(true)
    expect(resolveRoleModel(cfg, "coder-lite")).toBe("opencode-go/glm-5.3-flash")
  })

  it("overrides the lite and coder models", () => {
    // given
    const cfg = config({ lite_model: "test/lite-model", coder_model: "test/coder-model", coder_lite_model: "test/glm-flash" })

    // when // then
    expect(resolveRoleModel(cfg, "lite")).toBe("test/lite-model")
    expect(resolveRoleModel(cfg, "coder")).toBe("test/coder-model")
    expect(resolveRoleModel(cfg, "coder-lite")).toBe("test/glm-flash")
  })

  it("accepts a relocated lite workspace dir", () => {
    // given
    const cfg = config({ lite_workspace_dir: "/abs/lite-workspace" })

    // when // then
    expect(cfg.lite_workspace_dir).toBe("/abs/lite-workspace")
  })

  it("rejects an empty lite_workspace_dir instead of widening edit permission to all absolute paths", () => {
    // given // when // then
    expect(() => config({ lite_workspace_dir: "" })).toThrow()
  })

})

describe("coder-lite and build role configuration", () => {
  it("defaults the coder-lite lane model and the build routing target", () => {
    // given
    const cfg = config()

    // when // then
    expect(resolveRoleModel(cfg, "coder-lite")).toBe("opencode-go/glm-5.3-flash")
    expect(cfg.build_agent).toBe("build")
    expect(cfg.build_model).toBeUndefined()
  })

  it("overrides coder-lite and build from config", () => {
    // given
    const cfg = config({ coder_lite_model: "test/glm-flash", build_agent: "my-build", build_model: "test/build-m" })

    // when // then
    expect(resolveRoleModel(cfg, "coder-lite")).toBe("test/glm-flash")
    expect(cfg.build_agent).toBe("my-build")
    expect(cfg.build_model).toBe("test/build-m")
  })
})

describe("janus role configuration", () => {
  it("defaults the janus role and resolves its model to glm-5.3", () => {
    // given
    const cfg = config()

    // when // then
    expect(cfg.janus_agent).toBe("janus")
    expect(cfg.janus_enabled).toBe(true)
    expect(cfg.janus_model).toBeUndefined()
    expect(resolveRoleModel(cfg, "janus")).toBe("opencode-go/glm-5.3")
    expect(resolveRoleModelChain(cfg, "janus")).toEqual(["opencode-go/glm-5.3"])
  })

  it("overrides the janus model when janus_model is set", () => {
    // given
    const cfg = config({ janus_model: "test/janus-model" })

    // when // then
    expect(resolveRoleModel(cfg, "janus")).toBe("test/janus-model")
  })

  it("defaults the janus role when its keys are unset", () => {
    // given
    const cfg = config({ agent_model: "opencode-go/glm-5.3" })

    // when // then
    expect(cfg.janus_agent).toBe("janus")
    expect(cfg.janus_enabled).toBe(true)
  })
})

describe("model-prompt config surface (v2)", () => {
  it("parses the global model-keyed prompt map", () => {
    // given
    const cfg = config({ model_prompts: { "opencode-go/glm-5.3": "x" } })

    // when // then
    expect(cfg.model_prompts?.["opencode-go/glm-5.3"]).toBe("x")
  })

  it("accepts an explicit empty string as a disable marker", () => {
    // given
    const cfg = config({ model_prompts: { "opencode-go/deepseek-v4.1-flash": "" } })

    // when // then
    expect(cfg.model_prompts?.["opencode-go/deepseek-v4.1-flash"]).toBe("")
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
