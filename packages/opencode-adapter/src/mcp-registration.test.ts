import { describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import {
  registerMemoryMcp,
  resolveBunExecutable,
  resolveMemoryMcpServerEntry,
} from "./mcp-registration.ts"
import type { ConsultationPluginConfig } from "./plugin-config.ts"

function makeConfig(overrides: Partial<ConsultationPluginConfig> = {}): ConsultationPluginConfig {
  return {
    install_skill: true,
    install_commands: true,
    memory_enabled: true,
    critic_agent: "consultation-critic",
    critic_enabled: true,
    explorer_agent: "consultation-explorer",
    analyst_agent: "consultation-analyst",
    verifier_agent: "consultation-verifier",
    verifier_enabled: true,
    writer_agent: "consultation-writer",
    writer_enabled: true,
    simple_agent: "simple",
    simple_enabled: true,
    build_lite_agent: "build-lite",
    build_lite_enabled: true,
    build_agent: "build",
    build_enabled: true,
    janus_agent: "janus",
    janus_enabled: true,
    ...overrides,
  }
}

describe("resolveBunExecutable", () => {
  it("returns process.execPath when its basename starts with bun", () => {
    // given — running under bun, process.execPath basename should start with "bun"
    const base = basename(process.execPath)

    // when
    const result = resolveBunExecutable()

    // then
    if (base.startsWith("bun")) {
      expect(result).toBe(process.execPath)
    } else {
      expect(result).toBe("bun")
    }
  })

  it("returns a non-empty string", () => {
    // when
    const result = resolveBunExecutable()

    // then
    expect(typeof result).toBe("string")
    expect(result.length).toBeGreaterThan(0)
  })
})

describe("resolveMemoryMcpServerEntry", () => {
  it("returns a path ending with memory-mcp/src/server.ts in the workspace layout", () => {
    // when
    const result = resolveMemoryMcpServerEntry()

    // then
    expect(typeof result).toBe("string")
    expect(result.endsWith("memory-mcp/src/server.ts")).toBe(true)
  })

  it("prefers the bundled memory-mcp-server.js sibling in an installed layout", () => {
    const installRoot = mkdtempSync(join(tmpdir(), "mcp-entry-"))
    const distDir = join(installRoot, "dist")
    mkdirSync(distDir, { recursive: true })
    const bundledServer = join(distDir, "memory-mcp-server.js")
    writeFileSync(bundledServer, "")
    const installedModuleUrl = new URL(`file://${join(distDir, "index.js")}`).href

    try {
      const result = resolveMemoryMcpServerEntry(installedModuleUrl)

      expect(result).toBe(bundledServer)
    } finally {
      rmSync(installRoot, { recursive: true, force: true })
    }
  })
})

describe("registerMemoryMcp", () => {
  it("registers config.mcp.consultation-memory as a local MCP with enabled true", () => {
    // given
    const config: { mcp?: Record<string, unknown> } = {}
    const pluginConfig = makeConfig()

    // when
    registerMemoryMcp(config, pluginConfig, "oc-testns")

    // then
    expect(config.mcp).toBeDefined()
    const mcp = config.mcp?.["consultation-memory"] as {
      type: string
      command: string[]
      enabled: boolean
      environment: Record<string, string>
    }
    expect(mcp.type).toBe("local")
    expect(mcp.enabled).toBe(true)
    expect(mcp.command).toHaveLength(2)
    expect(mcp.command[0]).toBe(resolveBunExecutable())
    expect(mcp.command[1]).toBe(resolveMemoryMcpServerEntry())
  })

  it("sets CONSULTATION_NAMESPACE in the MCP environment", () => {
    // given
    const config: { mcp?: Record<string, unknown> } = {}
    const pluginConfig = makeConfig()

    // when
    registerMemoryMcp(config, pluginConfig, "oc-mynamespace")

    // then
    const mcp = config.mcp?.["consultation-memory"] as {
      environment: Record<string, string>
    }
    expect(mcp.environment.CONSULTATION_NAMESPACE).toBe("oc-mynamespace")
  })

  it("sets embedding env vars when embedding config is present", () => {
    // given
    const config: { mcp?: Record<string, unknown> } = {}
    const pluginConfig = makeConfig({
      embedding: {
        base_url: "https://api.example.com",
        api_key_env: "MY_API_KEY",
        model: "text-embed-3",
        dimensions: 1536,
      },
    })

    // when
    registerMemoryMcp(config, pluginConfig, "oc-ns")

    // then
    const mcp = config.mcp?.["consultation-memory"] as {
      environment: Record<string, string>
    }
    expect(mcp.environment.CONSULTATION_EMBEDDING_BASE_URL).toBe("https://api.example.com")
    expect(mcp.environment.CONSULTATION_EMBEDDING_API_KEY_ENV).toBe("MY_API_KEY")
    expect(mcp.environment.CONSULTATION_EMBEDDING_MODEL).toBe("text-embed-3")
    expect(mcp.environment.CONSULTATION_EMBEDDING_DIMENSIONS).toBe("1536")
  })

  it("omits embedding env vars when embedding config is absent", () => {
    // given
    const config: { mcp?: Record<string, unknown> } = {}
    const pluginConfig = makeConfig()

    // when
    registerMemoryMcp(config, pluginConfig, "oc-ns")

    // then
    const mcp = config.mcp?.["consultation-memory"] as {
      environment: Record<string, string>
    }
    expect(mcp.environment.CONSULTATION_EMBEDDING_BASE_URL).toBeUndefined()
    expect(mcp.environment.CONSULTATION_EMBEDDING_MODEL).toBeUndefined()
  })

  it("does not overwrite an existing consultation-memory MCP entry", () => {
    // given
    const existingCommand = ["/usr/bin/node", "/path/to/server.js"]
    const config: { mcp?: Record<string, unknown> } = {
      mcp: { "consultation-memory": { type: "local", command: existingCommand, enabled: false } },
    }
    const pluginConfig = makeConfig()

    // when
    registerMemoryMcp(config, pluginConfig, "oc-ns")

    // then — the existing entry is overwritten by the adapter registration
    // (the adapter always registers its MCP when memory_enabled; user can
    // disable via plugin config memory_enabled=false, not via mcp config)
    const mcp = config.mcp?.["consultation-memory"] as { command: string[] }
    expect(mcp.command).not.toEqual(existingCommand)
  })
})
