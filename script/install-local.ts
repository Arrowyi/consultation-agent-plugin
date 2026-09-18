#!/usr/bin/env bun
/**
 * Install a packaged (bundled) build into a stable prefix.
 *
 * Builds `dist/`, stages `dist/` + `assets/` into
 * `$CONSULTATION_INSTALL_DIR` or `$XDG_DATA_HOME/consultation-agent-plugin`
 * (default `~/.local/share/consultation-agent-plugin`), and verifies the
 * result. The installed bundle is self-contained: it needs neither the repo
 * source nor node_modules at runtime.
 *
 * Run from the repo root:  bun run install:local
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, "..")
const DIST_DIR = join(repoRoot, "dist")
const ASSETS_DIR = join(repoRoot, "assets")

export const REQUIRED_INSTALLED_FILES = [
  "dist/index.js",
  "dist/memory-mcp-server.js",
  "assets/agents/analyst.md",
  "assets/agents/consultant.md",
  "assets/agents/consultation-critic.md",
  "assets/agents/consultation-verifier.md",
  "assets/agents/explorer.md",
  "assets/agents/writer.md",
  "assets/skills/consultation/SKILL.md",
]

export function resolveInstallRoot(env: NodeJS.ProcessEnv): string {
  if (env.CONSULTATION_INSTALL_DIR && env.CONSULTATION_INSTALL_DIR.length > 0) {
    return env.CONSULTATION_INSTALL_DIR
  }
  const home = env.HOME && env.HOME.length > 0 ? env.HOME : homedir()
  const dataHome =
    env.XDG_DATA_HOME && env.XDG_DATA_HOME.length > 0
      ? env.XDG_DATA_HOME
      : join(home, ".local", "share")
  return join(dataHome, "consultation-agent-plugin")
}

async function runBuild(): Promise<void> {
  const proc = Bun.spawn(["bun", "run", "script/build.ts"], {
    cwd: repoRoot,
    stdout: "inherit",
    stderr: "inherit",
  })
  const code = await proc.exited
  if (code !== 0) {
    throw new Error(`build failed with exit code ${code}`)
  }
}

function readPackageVersion(): string {
  const parsed = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
    version?: string
  }
  return parsed.version ?? "0.0.0"
}

function gitSha(): string {
  const proc = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], { cwd: repoRoot })
  if (proc.exitCode !== 0) return "unknown"
  return proc.stdout.toString().trim() || "unknown"
}

function stage(installRoot: string): void {
  rmSync(join(installRoot, "dist"), { recursive: true, force: true })
  rmSync(join(installRoot, "assets"), { recursive: true, force: true })
  mkdirSync(installRoot, { recursive: true })
  cpSync(DIST_DIR, join(installRoot, "dist"), { recursive: true })
  cpSync(ASSETS_DIR, join(installRoot, "assets"), { recursive: true })
}

function writeManifests(installRoot: string): void {
  const version = readPackageVersion()
  writeFileSync(
    join(installRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "@consultation-agent/opencode-adapter",
        version,
        type: "module",
        main: "dist/index.js",
        private: true,
      },
      null,
      2,
    )}\n`,
  )
  writeFileSync(
    join(installRoot, "build-meta.json"),
    `${JSON.stringify(
      { version, gitSha: gitSha(), builtAt: new Date().toISOString(), source: repoRoot },
      null,
      2,
    )}\n`,
  )
}

function missingFiles(installRoot: string): string[] {
  return REQUIRED_INSTALLED_FILES.filter((rel) => !existsSync(join(installRoot, rel)))
}

async function main(): Promise<void> {
  const installRoot = resolveInstallRoot(process.env)
  console.log(`install root: ${installRoot}`)

  await runBuild()
  stage(installRoot)
  writeManifests(installRoot)

  const missing = missingFiles(installRoot)
  if (missing.length > 0) {
    console.error("FAIL: installed artifact is incomplete:")
    for (const rel of missing) console.error(`  missing: ${rel}`)
    process.exit(1)
  }

  const entry = `file://${join(installRoot, "dist/index.js")}`
  console.log(`installed ${REQUIRED_INSTALLED_FILES.length} required files`)
  console.log("")
  console.log("Point your OpenCode config at the installed bundle:")
  console.log(`  "plugin": ["${entry}"]`)
  console.log("")
  console.log("Verify the installed artifact:")
  console.log(`  CONSULTATION_PLUGIN_ENTRY=${entry} bun run integration`)
}

if (import.meta.main) {
  await main()
}
