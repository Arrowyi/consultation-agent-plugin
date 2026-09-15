import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { readFile } from "node:fs/promises"
import { installConsultationSkill, resolveOpencodeConfigDir } from "./skill-installer.ts"
import { resolveAsset } from "./asset-paths.ts"

describe("resolveOpencodeConfigDir", () => {
  const savedEnv: Record<string, string | undefined> = {}
  const envKeys = ["OPENCODE_CONFIG_DIR", "XDG_CONFIG_HOME", "HOME"]

  beforeEach(() => {
    for (const key of envKeys) savedEnv[key] = process.env[key]
  })

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) delete process.env[key]
      else process.env[key] = savedEnv[key]
    }
  })

  it("returns $OPENCODE_CONFIG_DIR when set", () => {
    // given
    process.env.OPENCODE_CONFIG_DIR = "/custom/oc-config"

    // when
    const dir = resolveOpencodeConfigDir(process.env)

    // then
    expect(dir).toBe("/custom/oc-config")
  })

  it("returns $XDG_CONFIG_HOME/opencode when OPENCODE_CONFIG_DIR is unset", () => {
    // given
    delete process.env.OPENCODE_CONFIG_DIR
    process.env.XDG_CONFIG_HOME = "/custom/xdg"

    // when
    const dir = resolveOpencodeConfigDir(process.env)

    // then
    expect(dir).toBe(join("/custom/xdg", "opencode"))
  })

  it("returns ~/.config/opencode when both OPENCODE_CONFIG_DIR and XDG_CONFIG_HOME are unset", () => {
    // given
    delete process.env.OPENCODE_CONFIG_DIR
    delete process.env.XDG_CONFIG_HOME
    process.env.HOME = "/home/testuser"

    // when
    const dir = resolveOpencodeConfigDir(process.env)

    // then
    expect(dir).toBe(join("/home/testuser", ".config", "opencode"))
  })
})

describe("installConsultationSkill", () => {
  const savedEnv: Record<string, string | undefined> = {}
  const envKeys = ["OPENCODE_CONFIG_DIR", "XDG_CONFIG_HOME", "HOME"]

  beforeEach(() => {
    for (const key of envKeys) savedEnv[key] = process.env[key]
  })

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) delete process.env[key]
      else process.env[key] = savedEnv[key]
    }
  })

  it("writes SKILL.md when the target file is missing", async () => {
    // given
    const tmpConfigDir = mkdtempSync(join(tmpdir(), "skill-missing-"))
    process.env.OPENCODE_CONFIG_DIR = tmpConfigDir
    const targetFile = join(tmpConfigDir, "skills", "consultation", "SKILL.md")

    try {
      expect(existsSync(targetFile)).toBe(false)

      // when
      await installConsultationSkill(process.env)

      // then
      expect(existsSync(targetFile)).toBe(true)
      const assetContent = await readFile(resolveAsset("skills/consultation/SKILL.md"), "utf8")
      const writtenContent = readFileSync(targetFile, "utf8")
      expect(writtenContent).toBe(assetContent)
    } finally {
      rmSync(tmpConfigDir, { recursive: true, force: true })
    }
  })

  it("does not rewrite SKILL.md when the content already matches", async () => {
    // given
    const tmpConfigDir = mkdtempSync(join(tmpdir(), "skill-match-"))
    process.env.OPENCODE_CONFIG_DIR = tmpConfigDir
    const targetDir = join(tmpConfigDir, "skills", "consultation")
    mkdirSync(targetDir, { recursive: true })
    const targetFile = join(targetDir, "SKILL.md")
    const assetContent = await readFile(resolveAsset("skills/consultation/SKILL.md"), "utf8")
    writeFileSync(targetFile, assetContent)
    const mtimeBefore = readFileSync(targetFile, "utf8")

    try {
      // when
      await installConsultationSkill(process.env)

      // then — content unchanged
      const mtimeAfter = readFileSync(targetFile, "utf8")
      expect(mtimeAfter).toBe(mtimeBefore)
      expect(mtimeAfter).toBe(assetContent)
    } finally {
      rmSync(tmpConfigDir, { recursive: true, force: true })
    }
  })

  it("rewrites SKILL.md when the content differs", async () => {
    // given
    const tmpConfigDir = mkdtempSync(join(tmpdir(), "skill-differs-"))
    process.env.OPENCODE_CONFIG_DIR = tmpConfigDir
    const targetDir = join(tmpConfigDir, "skills", "consultation")
    mkdirSync(targetDir, { recursive: true })
    const targetFile = join(targetDir, "SKILL.md")
    writeFileSync(targetFile, "# old stale content\n")

    try {
      // when
      await installConsultationSkill(process.env)

      // then
      const assetContent = await readFile(resolveAsset("skills/consultation/SKILL.md"), "utf8")
      const writtenContent = readFileSync(targetFile, "utf8")
      expect(writtenContent).toBe(assetContent)
      expect(writtenContent).not.toContain("old stale content")
    } finally {
      rmSync(tmpConfigDir, { recursive: true, force: true })
    }
  })

  it("never overwrites a file whose first line is <!-- user-modified -->", async () => {
    // given
    const tmpConfigDir = mkdtempSync(join(tmpdir(), "skill-usermod-"))
    process.env.OPENCODE_CONFIG_DIR = tmpConfigDir
    const targetDir = join(tmpConfigDir, "skills", "consultation")
    mkdirSync(targetDir, { recursive: true })
    const targetFile = join(targetDir, "SKILL.md")
    const userContent = "<!-- user-modified -->\n# my custom skill\n"
    writeFileSync(targetFile, userContent)

    try {
      // when
      await installConsultationSkill(process.env)

      // then — user content preserved
      const writtenContent = readFileSync(targetFile, "utf8")
      expect(writtenContent).toBe(userContent)
    } finally {
      rmSync(tmpConfigDir, { recursive: true, force: true })
    }
  })
})
