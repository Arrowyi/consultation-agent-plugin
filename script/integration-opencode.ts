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
 *       plugin entry. Defaults to the packaged `dist/index.js` (the artifact an
 *       installed deployment runs); override with `CONSULTATION_PLUGIN_ENTRY`
 *       (bare path or `file://` URL) to test another build, e.g. the adapter
 *       source for development or an installed bundle.
 *   (d) Spawn `opencode serve --port <free>` (a free port is picked via a
 *       short-lived Bun.serve so health polling has a known target; --port 0
 *       is supported by opencode but parsing stdout for the assigned port is
 *       fragile across versions). Wait for readiness via /global/health.
 *   (e) Assert via HTTP: GET /config responds 200 and its JSON contains the
 *       `consultant` agent key and the `consultation-memory` mcp key.
 *   (f) Assert the consultation skill file was installed at
 *       `<sandbox>/config/opencode/skills/consultation/SKILL.md`.
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

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, "..")

interface Assertion {
  readonly name: string
  readonly pass: boolean
  readonly detail: string
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Pick a free TCP port on 127.0.0.1 by briefly opening a Bun.serve listener
 * on port 0, reading the assigned port, then closing it immediately.
 */
function pickFreePort(): number {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => new Response("ok"),
  })
  const port = server.port
  server.stop(true)
  if (port === undefined) {
    throw new Error("failed to pick a free port: server.port is undefined")
  }
  return port
}

/**
 * Return true when `opencode --version` exits 0, false when it is not on PATH
 * or exits non-zero. Bun.spawn throws synchronously when the binary is missing.
 */
async function isOpencodeOnPath(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["opencode", "--version"], {
      stdout: "ignore",
      stderr: "ignore",
    })
    const code = await proc.exited
    return code === 0
  } catch {
    return false
  }
}

/**
 * Run `git status --porcelain` in the repo root and return the trimmed output.
 * Used to snapshot the repo state before and after the integration run.
 */
async function gitStatusPorcelain(): Promise<string> {
  const proc = Bun.spawn(["git", "status", "--porcelain"], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  })
  const text = await new Response(proc.stdout).text()
  await proc.exited
  return text.trim()
}

function toFileUrl(entry: string): string {
  return entry.startsWith("file://") ? entry : `file://${entry}`
}

/**
 * The plugin entry under test: `CONSULTATION_PLUGIN_ENTRY` when set, else the
 * packaged `dist/index.js` when it exists, else the adapter source.
 */
function resolvePluginEntry(): string {
  const override = process.env.CONSULTATION_PLUGIN_ENTRY
  if (override !== undefined && override.length > 0) return override
  const packaged = join(repoRoot, "dist/index.js")
  if (existsSync(packaged)) return packaged
  return join(repoRoot, "packages/opencode-adapter/src/index.ts")
}

/**
 * Poll an HTTP URL until it responds with a 2xx status or the timeout elapses.
 */
async function waitForHealth(url: string, auth: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(url, { headers: { Authorization: auth } })
      if (resp.ok) return true
    } catch {
      // connection refused — server not ready yet
    }
    await sleep(200)
  }
  return false
}

/**
 * Safely check whether a nested key path exists on an unknown JSON value.
 */
function hasNestedKey(obj: unknown, ...keys: string[]): boolean {
  let cur: unknown = obj
  for (const key of keys) {
    if (typeof cur !== "object" || cur === null) return false
    if (!(key in cur)) return false
    cur = (cur as Record<string, unknown>)[key]
  }
  return true
}

async function main(): Promise<void> {
  // (a) Check opencode on PATH.
  const onPath = await isOpencodeOnPath()
  if (!onPath) {
    console.log("SKIP: opencode is not on PATH.")
    console.log("SKIP: The integration test requires opencode to be installed and on PATH.")
    console.log("SKIP: Install opencode or add it to PATH, then re-run: bun run integration")
    process.exit(0)
  }
  console.log("integration: opencode found on PATH")

  // (b) Create the sandbox and subdirs.
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

  // (c) Write the opencode config with the plugin entry.
  const adapterEntry = resolvePluginEntry()
  console.log(`integration: plugin entry = ${adapterEntry}`)
  const opencodeConfigDir = join(sandboxConfig, "opencode")
  mkdirSync(opencodeConfigDir, { recursive: true })
  const opencodeConfig = {
    $schema: "https://opencode.ai/config.json",
    plugin: [toFileUrl(adapterEntry)],
  }
  writeFileSync(join(opencodeConfigDir, "opencode.json"), `${JSON.stringify(opencodeConfig, null, 2)}\n`)

  // (g, before) Snapshot the repo state before starting the server.
  const gitBefore = await gitStatusPorcelain()

  const assertions: Assertion[] = []
  let proc: ReturnType<typeof Bun.spawn> | null = null

  try {
    // (d) Pick a free port and spawn opencode serve.
    const port = pickFreePort()
    const baseUrl = `http://127.0.0.1:${port}`
    console.log(`integration: spawning opencode serve on port ${port}`)

    const childEnv: Record<string, string> = {
      ...process.env,
      XDG_DATA_HOME: sandboxData,
      XDG_CONFIG_HOME: sandboxConfig,
      XDG_STATE_HOME: sandboxState,
      XDG_CACHE_HOME: sandboxCache,
      HOME: sandboxHome,
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      OPENCODE_DISABLE_MODELS_FETCH: "1",
      OPENCODE_SERVER_PASSWORD: password,
    }

    proc = Bun.spawn(["opencode", "serve", "--port", String(port), "--hostname", "127.0.0.1"], {
      cwd: sandboxProj,
      env: childEnv,
      stdout: "inherit",
      stderr: "inherit",
    })

    // Wait for readiness.
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

      // (e) Assert GET /config responds 200 and contains the agent and mcp keys.
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
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        assertions.push({ name: "GET /config", pass: false, detail: `fetch error: ${detail}` })
      }

      // (f) Assert the consultation skill file was installed.
      const skillPath = join(sandboxConfig, "opencode", "skills", "consultation", "SKILL.md")
      const skillExists = existsSync(skillPath)
      assertions.push({
        name: "consultation skill installed in sandbox config",
        pass: skillExists,
        detail: skillExists ? skillPath : `NOT FOUND: ${skillPath}`,
      })
    }

    // (g, after) Compare repo state before and after.
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
    // (h) Kill the server.
    if (proc !== null) {
      try {
        proc.kill("SIGTERM")
      } catch {
        // already dead
      }
      try {
        await proc.exited
      } catch {
        // process already exited
      }
    }
    // Clean up the sandbox.
    rmSync(sandbox, { recursive: true, force: true })
  }

  // (h) Print the PASS/FAIL evidence summary.
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
