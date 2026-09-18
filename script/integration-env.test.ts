import { describe, expect, test } from "bun:test"
import { buildCleanRoomEnv, CLEANROOM_BLOCKED_KEYS } from "./integration-env.ts"

describe("buildCleanRoomEnv", () => {
  const sandbox = {
    home: "/tmp/clean/home",
    xdgConfigHome: "/tmp/clean/config",
    xdgDataHome: "/tmp/clean/data",
    xdgStateHome: "/tmp/clean/state",
    xdgCacheHome: "/tmp/clean/cache",
  } as const

  test("isolates HOME and XDG paths without mutating the parent env", () => {
    const parent: NodeJS.ProcessEnv = {
      HOME: "/home/dev",
      XDG_CONFIG_HOME: "/home/dev/.config",
      XDG_DATA_HOME: "/home/dev/.local/share",
      XDG_STATE_HOME: "/home/dev/.local/state",
      XDG_CACHE_HOME: "/home/dev/.cache",
      PATH: "/usr/bin",
    }

    const env = buildCleanRoomEnv(parent, sandbox)

    expect(env.HOME).toBe(sandbox.home)
    expect(env.XDG_CONFIG_HOME).toBe(sandbox.xdgConfigHome)
    expect(env.XDG_DATA_HOME).toBe(sandbox.xdgDataHome)
    expect(env.XDG_STATE_HOME).toBe(sandbox.xdgStateHome)
    expect(env.XDG_CACHE_HOME).toBe(sandbox.xdgCacheHome)
    expect(env.PATH).toBe("/usr/bin")
    expect(parent.HOME).toBe("/home/dev")
  })

  test("scrubs developer-local OpenCode and plugin config overrides", () => {
    const parent: NodeJS.ProcessEnv = {
      HOME: "/home/dev",
      CONSULTATION_CONFIG: "/home/dev/.config/consultation-agent/config.jsonc",
      OPENCODE_CONFIG: "/home/dev/.config/opencode/opencode.json",
      OPENCODE_CONFIG_CONTENT: '{"model":"local"}',
      OPENCODE_CONFIG_DIR: "/home/dev/.config/opencode",
    }

    const env = buildCleanRoomEnv(parent, sandbox)

    for (const key of CLEANROOM_BLOCKED_KEYS) {
      expect(env[key]).toBeUndefined()
    }
  })

  test("disables external skills and autoupdate while preserving explicit plugin entry", () => {
    const parent: NodeJS.ProcessEnv = {
      HOME: "/home/dev",
      CONSULTATION_PLUGIN_ENTRY: "file:///tmp/stage/dist/index.js",
    }

    const env = buildCleanRoomEnv(parent, sandbox)

    expect(env.OPENCODE_DISABLE_EXTERNAL_SKILLS).toBe("1")
    expect(env.OPENCODE_DISABLE_CLAUDE_CODE_SKILLS).toBe("1")
    expect(env.OPENCODE_DISABLE_AUTOUPDATE).toBe("1")
    expect(env.OPENCODE_DISABLE_MODELS_FETCH).toBe("1")
    expect(env.CONSULTATION_PLUGIN_ENTRY).toBe("file:///tmp/stage/dist/index.js")
  })

  test("scrubs inherited pure-mode and default-plugin disabling flags", () => {
    const parent: NodeJS.ProcessEnv = {
      HOME: "/home/dev",
      OPENCODE_PURE: "1",
      OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
      OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    }

    const env = buildCleanRoomEnv(parent, sandbox)

    expect(env.OPENCODE_PURE).toBeUndefined()
    expect(env.OPENCODE_DISABLE_DEFAULT_PLUGINS).toBeUndefined()
    expect(env.OPENCODE_DISABLE_PROJECT_CONFIG).toBeUndefined()
  })
})
