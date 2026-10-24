import { existsSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

export interface Assertion {
  readonly name: string
  readonly pass: boolean
  readonly detail: string
}

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, "..")

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export function pickFreePort(): number {
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

export async function isOpencodeOnPath(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["opencode", "--version"], {
      stdout: "ignore",
      stderr: "ignore",
    })
    const code = await proc.exited
    return code === 0
  } catch (error) {
    if (error instanceof Error) return false
    throw error
  }
}

export async function gitStatusPorcelain(): Promise<string> {
  const proc = Bun.spawn(["git", "status", "--porcelain"], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  })
  const text = await new Response(proc.stdout).text()
  await proc.exited
  return text.trim()
}

export function toFileUrl(entry: string): string {
  return entry.startsWith("file://") ? entry : pathToFileURL(entry).href
}

function filePathFromEntry(entry: string): string {
  return entry.startsWith("file://") ? fileURLToPath(entry) : entry
}

export function writerAssetPathForEntry(entry: string): string | undefined {
  const fsPath = filePathFromEntry(entry)
  if (!fsPath.endsWith("dist/index.js")) return undefined
  return join(dirname(dirname(fsPath)), "assets", "agents", "writer.md")
}

export type InstallMetadata = {
  readonly prefix: string
  readonly installRoot: string
  readonly entry: string
}

export function computeInstallMetadata(prefix: string): InstallMetadata {
  const installRoot = join(prefix, "janus-agent-plugin")
  return {
    prefix,
    installRoot,
    entry: join(installRoot, "dist/index.js"),
  }
}

async function installBundleToTempPrefix(): Promise<InstallMetadata> {
  const prefix = mkdtempSync(join(tmpdir(), "consult-install-"))
  const metadata = computeInstallMetadata(prefix)
  console.log(`integration: installing bundle to ${metadata.installRoot}`)
  const proc = Bun.spawn(["bun", "run", "script/install-local.ts"], {
    cwd: repoRoot,
    env: { ...process.env, JANUS_INSTALL_DIR: metadata.installRoot },
    stdout: "inherit",
    stderr: "inherit",
  })
  const code = await proc.exited
  if (code !== 0) {
    throw new Error(`install-local failed with exit code ${code}`)
  }
  return metadata
}

export type PluginEntry =
  | { readonly kind: "override"; readonly entry: string }
  | ({ readonly kind: "installed" } & InstallMetadata)

export async function resolvePluginEntry(): Promise<PluginEntry> {
  const override = process.env.JANUS_PLUGIN_ENTRY
  if (override !== undefined && override.length > 0) {
    return { kind: "override", entry: override }
  }
  return { kind: "installed", ...(await installBundleToTempPrefix()) }
}

export async function waitForHealth(url: string, auth: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(url, { headers: { Authorization: auth } })
      if (resp.ok) return true
    } catch (error) {
      if (!(error instanceof Error)) throw error
    }
    await sleep(200)
  }
  return false
}

export function hasNestedKey(obj: unknown, ...keys: string[]): boolean {
  let cur: unknown = obj
  for (const key of keys) {
    if (typeof cur !== "object" || cur === null) return false
    if (!(key in cur)) return false
    cur = (cur as Record<string, unknown>)[key]
  }
  return true
}
