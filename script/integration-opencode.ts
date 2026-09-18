#!/usr/bin/env bun
/**
 * Isolated OpenCode integration proof for the consultation-agent plugin.
 *
 * Behavior:
 *   (a) If `opencode` is not on PATH, print a clear SKIP message and exit 0.
 *   (b) Create a temp sandbox dir; set XDG_DATA_HOME / XDG_CONFIG_HOME /
 *       XDG_STATE_HOME / XDG_CACHE_HOME (and HOME) to subdirs of it for the
 *       opencode child process so the real user config/DB is never touched.
 *   (c) Write `<sandbox>/config/opencode/opencode.json` with a `file://`
 *       plugin entry. By default this script builds the bundle and installs it
 *       into a fresh temporary prefix, then points OpenCode at that installed
 *       `dist/index.js`. Override the entry with `CONSULTATION_PLUGIN_ENTRY`
 *       (bare path or `file://` URL) to test another build.
 *   (d) Spawn `opencode serve --port <free>` (a free port is picked via a
 *       short-lived Bun.serve so health polling has a known target; --port 0
 *       is supported by opencode but parsing stdout for the assigned port is
 *       fragile across versions). Wait for readiness via /global/health.
 *   (e) Assert via HTTP: GET /config responds 200 and its JSON contains the
 *       `consultant` agent key, the `consultation-writer` agent key, and the
 *       `consultation-memory` mcp key.
 *   (f) Assert the consultation skill file was installed at
 *       `<sandbox>/config/opencode/skills/consultation/SKILL.md` and contains
 *       the `author` mode contract.
 *   (g) Assert NOTHING was written into the plugin repo directory during the
 *       run by comparing `git status --porcelain` before and after.
 *   (h) Kill the server, print a PASS/FAIL evidence summary per assertion,
 *       exit non-zero on any FAIL.
 *
 * Run from the repo root:  bun run integration
 *
 * Self-contained: only Bun builtins (Bun.spawn, Bun.serve, fetch) and
 * node:fs / node:os / node:path.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildCleanRoomEnv } from "./integration-env.ts"
import {
  type Assertion,
  gitStatusPorcelain,
  hasNestedKey,
  isOpencodeOnPath,
  pickFreePort,
  resolvePluginEntry,
  toFileUrl,
  waitForHealth,
  writerAssetPathForEntry,
} from "./integration-helpers.ts"

async function main(): Promise<void> {
  const onPath = await isOpencodeOnPath()
  if (!onPath) {
    console.log("SKIP: opencode is not on PATH.")
    console.log("SKIP: The integration test requires opencode to be installed and on PATH.")
    console.log("SKIP: Install opencode or add it to PATH, then re-run: bun run integration")
    process.exit(0)
  }
  console.log("integration: opencode found on PATH")

  const sandbox = mkdtempSync(join(tmpdir(), "consult-integration-"))
  const sandboxData = join(sandbox, "data")
  const sandboxConfig = join(sandbox, "config")
  const sandboxState = join(sandbox, "state")
  const sandboxCache = join(sandbox, "cache")
  const sandboxHome = join(sandbox, "home")
  const sandboxProj = join(sandbox, "proj")
  for (const dir of [sandboxData, sandboxConfig, sandboxState, sandboxCache, sandboxHome, sandboxProj]) {
    mkdirSync(dir, { recursive: true })
  }

  const password = `int-${Math.random().toString(36).slice(2)}`
  const auth = `Basic ${btoa(`opencode:${password}`)}`

  const pluginEntry = await resolvePluginEntry()
  const adapterEntry = pluginEntry.entry
  console.log(`integration: plugin entry = ${adapterEntry}`)
  const installPrefix = pluginEntry.kind !== "override" ? pluginEntry.prefix : undefined
  const opencodeConfigDir = join(sandboxConfig, "opencode")
  mkdirSync(opencodeConfigDir, { recursive: true })
  const opencodeConfig = {
    $schema: "https://opencode.ai/config.json",
    plugin: [toFileUrl(adapterEntry)],
  }
  writeFileSync(join(opencodeConfigDir, "opencode.json"), `${JSON.stringify(opencodeConfig, null, 2)}\n`)

  const gitBefore = await gitStatusPorcelain()

  const assertions: Assertion[] = []

  const writerAssetPath = writerAssetPathForEntry(adapterEntry)
  if (writerAssetPath !== undefined) {
    const writerAssetExists = existsSync(writerAssetPath)
    assertions.push({
      name: "packaged writer asset exists in plugin prefix",
      pass: writerAssetExists,
      detail: writerAssetExists ? writerAssetPath : `NOT FOUND: ${writerAssetPath}`,
    })
  }

  let proc: ReturnType<typeof Bun.spawn> | null = null

  try {
    const port = pickFreePort()
    const baseUrl = `http://127.0.0.1:${port}`
    console.log(`integration: spawning opencode serve on port ${port}`)

    const sandboxPaths = {
      home: sandboxHome,
      xdgConfigHome: sandboxConfig,
      xdgDataHome: sandboxData,
      xdgStateHome: sandboxState,
      xdgCacheHome: sandboxCache,
    }
    const childEnv = buildCleanRoomEnv(process.env, sandboxPaths)
    childEnv.OPENCODE_SERVER_PASSWORD = password

    proc = Bun.spawn(["opencode", "serve", "--port", String(port), "--hostname", "127.0.0.1"], {
      cwd: sandboxProj,
      env: childEnv,
      stdout: "inherit",
      stderr: "inherit",
    })

    const ready = await waitForHealth(`${baseUrl}/global/health`, auth, 30000)
    if (!ready) {
      assertions.push({
        name: "server readiness",
        pass: false,
        detail: "opencode serve did not become ready within 30s (check stderr above for errors)",
      })
    } else {
      assertions.push({
        name: "server readiness",
        pass: true,
        detail: `GET /global/health responded 200 (${baseUrl})`,
      })

      try {
        const resp = await fetch(`${baseUrl}/config`, { headers: { Authorization: auth } })
        const status = resp.status
        assertions.push({
          name: "GET /config responds 200",
          pass: status === 200,
          detail: `status=${status}`,
        })

        if (status === 200) {
          const json: unknown = await resp.json()
          const hasConsultant = hasNestedKey(json, "agent", "consultant")
          const hasMemoryMcp = hasNestedKey(json, "mcp", "consultation-memory")
          const hasWriter = hasNestedKey(json, "agent", "consultation-writer")
          assertions.push({
            name: "config has consultant agent key",
            pass: hasConsultant,
            detail: hasConsultant ? "agent.consultant present" : "agent.consultant MISSING",
          })
          assertions.push({
            name: "config has consultation-memory mcp key",
            pass: hasMemoryMcp,
            detail: hasMemoryMcp ? "mcp.consultation-memory present" : "mcp.consultation-memory MISSING",
          })
          assertions.push({
            name: "config has packaged writer agent key",
            pass: hasWriter,
            detail: hasWriter ? "agent.consultation-writer present" : "agent.consultation-writer MISSING",
          })
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        assertions.push({ name: "GET /config", pass: false, detail: `fetch error: ${detail}` })
      }

      const skillPath = join(sandboxConfig, "opencode", "skills", "consultation", "SKILL.md")
      const skillExists = existsSync(skillPath)
      assertions.push({
        name: "consultation skill installed in sandbox config",
        pass: skillExists,
        detail: skillExists ? skillPath : `NOT FOUND: ${skillPath}`,
      })

      if (skillExists) {
        const skillText = readFileSync(skillPath, "utf8")
        const hasAuthor = skillText.includes("`author`")
        assertions.push({
          name: "installed consultation skill contains author mode",
          pass: hasAuthor,
          detail: hasAuthor ? "skill text contains `author`" : "skill text MISSING `author`",
        })
      }
    }

    const gitAfter = await gitStatusPorcelain()
    const repoUntouched = gitBefore === gitAfter
    assertions.push({
      name: "repo directory untouched during run",
      pass: repoUntouched,
      detail: repoUntouched
        ? "git status --porcelain unchanged before vs after"
        : "git status --porcelain CHANGED (new files written into the repo)",
    })
  } finally {
    if (proc !== null) {
      try {
        proc.kill("SIGTERM")
      } catch (error) {
        if (!(error instanceof Error)) throw error
      }
      try {
        await proc.exited
      } catch (error) {
        if (!(error instanceof Error)) throw error
      }
    }
    rmSync(sandbox, { recursive: true, force: true })
    if (installPrefix !== undefined) {
      rmSync(installPrefix, { recursive: true, force: true })
    }
  }

  console.log("")
  console.log("=== integration evidence ===")
  for (const a of assertions) {
    const tag = a.pass ? "PASS" : "FAIL"
    console.log(`  ${tag}: ${a.name} - ${a.detail}`)
  }

  const allPass = assertions.length > 0 && assertions.every((a) => a.pass)
  console.log("")
  if (allPass) {
    console.log(`integration: PASS (${assertions.length} assertions)`)
    process.exit(0)
  } else {
    const fails = assertions.filter((a) => !a.pass).length
    console.error(`integration: FAIL (${fails} of ${assertions.length} assertions failed)`)
    process.exit(1)
  }
}

await main()
