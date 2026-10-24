import { describe, expect, test } from "bun:test"
import { REQUIRED_INSTALLED_FILES, resolveInstallRoot } from "./install-local.ts"

describe("resolveInstallRoot", () => {
  test("uses JANUS_INSTALL_DIR when present", () => {
    const env: NodeJS.ProcessEnv = {
      JANUS_INSTALL_DIR: "/tmp/stage/janus-agent-plugin",
    }

    const root = resolveInstallRoot(env)

    expect(root).toBe("/tmp/stage/janus-agent-plugin")
  })

  test("falls back to XDG_DATA_HOME when JANUS_INSTALL_DIR is absent", () => {
    const env: NodeJS.ProcessEnv = {
      XDG_DATA_HOME: "/tmp/xdg-data",
    }

    const root = resolveInstallRoot(env)

    expect(root).toBe("/tmp/xdg-data/janus-agent-plugin")
  })

  test("falls back to HOME/.local/share when no XDG override is set", () => {
    const env: NodeJS.ProcessEnv = {
      HOME: "/home/dev",
    }

    const root = resolveInstallRoot(env)

    expect(root).toBe("/home/dev/.local/share/janus-agent-plugin")
  })
})

describe("REQUIRED_INSTALLED_FILES", () => {
  test("requires the packaged writer agent asset", () => {
    expect(REQUIRED_INSTALLED_FILES).toContain("assets/agents/writer.md")
  })

  test("requires the core bundled entry points and role assets", () => {
    expect(REQUIRED_INSTALLED_FILES).toContain("dist/index.js")
    expect(REQUIRED_INSTALLED_FILES).toContain("dist/memory-mcp-server.js")
    expect(REQUIRED_INSTALLED_FILES).toContain("assets/agents/consultant.md")
    expect(REQUIRED_INSTALLED_FILES).toContain("assets/skills/consultation/SKILL.md")
  })

  test("requires the coder, lite, and coder-lite agents and the shipped model-prompt library", () => {
    expect(REQUIRED_INSTALLED_FILES).toContain("assets/agents/coder.md")
    expect(REQUIRED_INSTALLED_FILES).toContain("assets/agents/lite.md")
    expect(REQUIRED_INSTALLED_FILES).toContain("assets/agents/coder-lite.md")
    expect(REQUIRED_INSTALLED_FILES).toContain("assets/model-prompts/claudesonnet55.md")
    expect(REQUIRED_INSTALLED_FILES).toContain("assets/model-prompts/gemini38flash.md")
    expect(REQUIRED_INSTALLED_FILES).toContain("assets/model-prompts/deepseekflash.md")
    expect(REQUIRED_INSTALLED_FILES).toContain("assets/model-prompts/deepseekv41flash.md")
    expect(REQUIRED_INSTALLED_FILES).toContain("assets/model-prompts/glm53flash.md")
    expect(REQUIRED_INSTALLED_FILES).toContain("assets/model-prompts/glm53.md")
    expect(REQUIRED_INSTALLED_FILES).toContain("assets/model-prompts/qwen38max.md")
  })
})
