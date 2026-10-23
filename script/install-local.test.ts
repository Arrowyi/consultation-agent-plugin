import { describe, expect, test } from "bun:test"
import { REQUIRED_INSTALLED_FILES, resolveInstallRoot } from "./install-local.ts"

describe("resolveInstallRoot", () => {
  test("uses CONSULTATION_INSTALL_DIR when present", () => {
    const env: NodeJS.ProcessEnv = {
      CONSULTATION_INSTALL_DIR: "/tmp/stage/consultation-agent-plugin",
    }

    const root = resolveInstallRoot(env)

    expect(root).toBe("/tmp/stage/consultation-agent-plugin")
  })

  test("falls back to XDG_DATA_HOME when CONSULTATION_INSTALL_DIR is absent", () => {
    const env: NodeJS.ProcessEnv = {
      XDG_DATA_HOME: "/tmp/xdg-data",
    }

    const root = resolveInstallRoot(env)

    expect(root).toBe("/tmp/xdg-data/consultation-agent-plugin")
  })

  test("falls back to HOME/.local/share when no XDG override is set", () => {
    const env: NodeJS.ProcessEnv = {
      HOME: "/home/dev",
    }

    const root = resolveInstallRoot(env)

    expect(root).toBe("/home/dev/.local/share/consultation-agent-plugin")
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

  test("requires the simple and build-lite agents and the shipped model-prompt library", () => {
    expect(REQUIRED_INSTALLED_FILES).toContain("assets/agents/simple.md")
    expect(REQUIRED_INSTALLED_FILES).toContain("assets/agents/build-lite.md")
    expect(REQUIRED_INSTALLED_FILES).toContain("assets/model-prompts/opencode-claude-sonnet-5-5.md")
    expect(REQUIRED_INSTALLED_FILES).toContain("assets/model-prompts/opencode-gemini-3.8-flash.md")
    expect(REQUIRED_INSTALLED_FILES).toContain("assets/model-prompts/opencode-go-deepseek-v4.1-flash.md")
    expect(REQUIRED_INSTALLED_FILES).toContain("assets/model-prompts/opencode-go-glm-5.3-flash.md")
    expect(REQUIRED_INSTALLED_FILES).toContain("assets/model-prompts/opencode-go-glm-5.3.md")
    expect(REQUIRED_INSTALLED_FILES).toContain("assets/model-prompts/opencode-go-qwen3.8-max.md")
    expect(REQUIRED_INSTALLED_FILES).not.toContain("assets/model-prompts/simple.md")
    expect(REQUIRED_INSTALLED_FILES).not.toContain("assets/model-prompts/build-lite.md")
  })
})
