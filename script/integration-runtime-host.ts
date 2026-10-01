import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildCleanRoomEnv } from "./integration-env.ts"
import { pickFreePort, resolvePluginEntry, toFileUrl, waitForHealth } from "./integration-helpers.ts"
import { MessageSchema, SessionSchema } from "./integration-dispatch-primitives.ts"

export async function createRuntimeHost(providerURL: string) {
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), "consult-lifecycle-")))
  const project = join(sandbox, "proj")
  const configHome = join(sandbox, "config")
  for (const name of ["home", "data", "state", "cache", "proj", "config/opencode", "config/consultation-agent"]) mkdirSync(join(sandbox, name), { recursive: true })
  const entry = await resolvePluginEntry()
  const modelNames = ["consultant", "explorer", "analyst", "critic", "verifier", "writer", "backup", "delegate"]
  const config = {
    $schema: "https://opencode.ai/config.json", plugin: [toFileUrl(entry.entry)],
    enabled_providers: ["fixture"], model: "fixture/consultant", small_model: "fixture/consultant",
    provider: { fixture: { npm: "@ai-sdk/openai-compatible", name: "Deterministic local fixture", options: { baseURL: `${providerURL}/v1`, apiKey: "fixture-only", timeout: false, headerTimeout: false, chunkTimeout: false }, models: Object.fromEntries(modelNames.map((name) => [name, { name, tool_call: true, cost: { input: 0, output: 0 }, limit: { context: 100000, output: 4096 } }])) } },
    agent: { "fixture-delegate": { mode: "subagent", model: "fixture/delegate", permission: { read: "allow" } } },
    snapshot: false, share: "disabled", compaction: { auto: false },
  }
  writeFileSync(join(configHome, "opencode/opencode.json"), JSON.stringify(config))
  const pluginConfig = { agent_model: "fixture/consultant", explorer_model: "fixture/explorer", analyst_model: "fixture/analyst", critic_model: "fixture/critic", verifier_model: "fixture/verifier", writer_model: "fixture/writer", writer_fallback_models: ["fixture/backup"], memory_enabled: false }
  const pluginConfigPath = join(configHome, "consultation-agent/config.jsonc")
  writeFileSync(pluginConfigPath, JSON.stringify(pluginConfig))
  writeFileSync(join(project, "fixture.txt"), "deterministic read fixture")
  const env = buildCleanRoomEnv(process.env, { home: join(sandbox, "home"), xdgConfigHome: configHome, xdgDataHome: join(sandbox, "data"), xdgStateHome: join(sandbox, "state"), xdgCacheHome: join(sandbox, "cache") })
  const auth = `Basic ${btoa("opencode:fixture-local")}`
  env.OPENCODE_SERVER_PASSWORD = "fixture-local"
  const port = pickFreePort()
  const url = `http://127.0.0.1:${port}`
  let proc: ReturnType<typeof Bun.spawn> | undefined
  const calls: { readonly path: string; readonly method: string }[] = []
  async function api(path: string, body?: unknown): Promise<unknown> {
    calls.push({ path, method: body === undefined ? "GET" : "POST" })
    const response = await fetch(`${url}${path}?directory=${encodeURIComponent(project)}`, { method: body === undefined ? "GET" : "POST", headers: { Authorization: auth, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(420000) })
    if (!response.ok) throw new Error(`host HTTP ${response.status}: ${await response.text()}`)
    if (response.status === 204) return null
    return response.json()
  }
  async function stop() {
    if (proc !== undefined) { proc.kill("SIGKILL"); await proc.exited; proc = undefined }
  }
  async function start() {
    proc = Bun.spawn(["opencode", "serve", "--port", String(port), "--hostname", "127.0.0.1"], { cwd: project, env, stdout: "inherit", stderr: "inherit" })
    if (!await waitForHealth(`${url}/global/health`, auth, 30000)) throw new Error("runtime server did not start")
    await api("/config")
  }
  return {
    sandbox, project, entry: entry.entry, api, calls, start, stop,
    async restart(delegate = false, delegateModel?: string) {
      await stop()
      const extra: Record<string, string> = {}
      if (delegate) extra.writer_delegate_agent = "fixture-delegate"
      if (delegateModel !== undefined) extra.writer_delegate_model = delegateModel
      writeFileSync(pluginConfigPath, JSON.stringify({ ...pluginConfig, ...extra }))
      await start()
    },
    async createParent() { return SessionSchema.parse(await api("/session", { title: "deterministic lifecycle parent" })).id },
    async messages(id: string) { return MessageSchema.array().parse(await api(`/session/${id}/message`)) },
    async children(id: string) { return SessionSchema.array().parse(await api(`/session/${id}/children`)) },
    async cleanup() { await stop(); rmSync(sandbox, { recursive: true, force: true }); if (entry.kind === "installed") rmSync(entry.prefix, { recursive: true, force: true }) },
  }
}
export type RuntimeHost = Awaited<ReturnType<typeof createRuntimeHost>>
