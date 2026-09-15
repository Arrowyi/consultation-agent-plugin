import { describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolveAsset, resolveAssetFromUrl } from "./asset-paths.ts"

describe("resolveAsset", () => {
  it("resolves agents/consultant.md to an existing file in the real workspace layout", () => {
    // given
    const relativePath = "agents/consultant.md"

    // when
    const resolved = resolveAsset(relativePath)

    // then
    expect(existsSync(resolved)).toBe(true)
  })

  it("resolves skills/consultation/SKILL.md to an existing file in the real workspace layout", () => {
    // given
    const relativePath = "skills/consultation/SKILL.md"

    // when
    const resolved = resolveAsset(relativePath)

    // then
    expect(existsSync(resolved)).toBe(true)
  })

  it("the resolved consultant.md contains the RUNTIME-BINDINGS placeholder", async () => {
    // given
    const relativePath = "agents/consultant.md"

    // when
    const resolved = resolveAsset(relativePath)
    const content = await readFile(resolved, "utf8")

    // then
    expect(content).toContain("RUNTIME-BINDINGS")
  })
})

describe("resolveAssetFromUrl fallback walk", () => {
  it("uses the primary URL path when the file exists there", () => {
    // given — the real module URL, primary path points at repo-root/assets
    const moduleUrl = import.meta.url

    // when
    const resolved = resolveAssetFromUrl("agents/consultant.md", moduleUrl)

    // then
    expect(existsSync(resolved)).toBe(true)
  })

  it("walks up parent directories to find assets when the primary path does not exist", () => {
    // given — a fake deep layout where assets/ is 4 levels above the "module"
    const tmpRoot = mkdtempSync(join(tmpdir(), "asset-fallback-"))
    const deepDir = join(tmpRoot, "a", "b", "c", "d", "src")
    mkdirSync(deepDir, { recursive: true })
    const fakeModulePath = join(deepDir, "plugin.js")
    writeFileSync(fakeModulePath, "")
    // place assets at tmpRoot/assets so the walk-up from deepDir finds it
    const assetsDir = join(tmpRoot, "assets", "agents")
    mkdirSync(assetsDir, { recursive: true })
    writeFileSync(join(assetsDir, "consultant.md"), "# fake consultant")
    const fakeModuleUrl = new URL(`file://${fakeModulePath}`).href

    try {
      // when
      const resolved = resolveAssetFromUrl("agents/consultant.md", fakeModuleUrl)

      // then
      expect(existsSync(resolved)).toBe(true)
      expect(resolved).toContain("consultant.md")
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true })
    }
  })

  it("resolves assets in a packaged install layout where assets/ sits beside dist/", () => {
    const installRoot = mkdtempSync(join(tmpdir(), "install-layout-"))
    const distDir = join(installRoot, "dist")
    mkdirSync(distDir, { recursive: true })
    const installedModule = join(distDir, "index.js")
    writeFileSync(installedModule, "")
    const agentsDir = join(installRoot, "assets", "agents")
    mkdirSync(agentsDir, { recursive: true })
    writeFileSync(join(agentsDir, "consultant.md"), "# installed consultant")
    const installedModuleUrl = new URL(`file://${installedModule}`).href

    try {
      const resolved = resolveAssetFromUrl("agents/consultant.md", installedModuleUrl)

      expect(resolved).toBe(join(installRoot, "assets", "agents", "consultant.md"))
      expect(existsSync(resolved)).toBe(true)
    } finally {
      rmSync(installRoot, { recursive: true, force: true })
    }
  })

  it("returns the primary path even when no asset is found, so readFile gives a clear error", () => {
    // given — a layout with no assets anywhere
    const tmpRoot = mkdtempSync(join(tmpdir(), "asset-none-"))
    const deepDir = join(tmpRoot, "x", "y", "src")
    mkdirSync(deepDir, { recursive: true })
    const fakeModulePath = join(deepDir, "mod.js")
    writeFileSync(fakeModulePath, "")
    const fakeModuleUrl = new URL(`file://${fakeModulePath}`).href

    try {
      // when
      const resolved = resolveAssetFromUrl("agents/consultant.md", fakeModuleUrl)

      // then — returns the primary path string (which does not exist)
      expect(typeof resolved).toBe("string")
      expect(resolved).toContain("consultant.md")
      expect(existsSync(resolved)).toBe(false)
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true })
    }
  })
})
