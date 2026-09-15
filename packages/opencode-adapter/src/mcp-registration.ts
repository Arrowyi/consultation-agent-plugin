import { existsSync } from "node:fs"
import { basename } from "node:path"
import { fileURLToPath } from "node:url"
import type { ConsultationPluginConfig } from "./plugin-config.ts"

interface MutableConfig {
  mcp?: Record<string, unknown>
}

interface McpLocalEntry {
  type: "local"
  command: string[]
  enabled: boolean
  environment: Record<string, string>
}

/**
 * Resolve the bun executable to use for spawning the memory MCP server.
 *
 * Returns `process.execPath` when its basename starts with `"bun"`
 * (running under the Bun runtime), otherwise returns the bare `"bun"`
 * string (expected on PATH).
 */
export function resolveBunExecutable(): string {
  const execPath = process.execPath
  const base = basename(execPath)
  if (base.startsWith("bun")) {
    return execPath
  }
  return "bun"
}

/**
 * Resolve the memory MCP server entry: bundled `memory-mcp-server.js`
 * sibling first (installed layout), then the workspace `src/server.ts`,
 * then the relative workspace fallback. Never throws.
 */
export function resolveMemoryMcpServerEntry(moduleUrl: string = import.meta.url): string {
  const bundled = fileURLToPath(new URL("memory-mcp-server.js", moduleUrl))
  if (existsSync(bundled)) return bundled

  try {
    const pkgUrl = import.meta.resolve("@consultation-agent/memory-mcp/package.json")
    const fromPackage = fileURLToPath(new URL("src/server.ts", pkgUrl))
    if (existsSync(fromPackage)) return fromPackage
  } catch {
    // workspace package unavailable (installed layout) — fall through
  }

  return fileURLToPath(new URL("../../memory-mcp/src/server.ts", moduleUrl))
}

function buildEmbeddingEnv(
  pluginConfig: ConsultationPluginConfig,
): Record<string, string> {
  if (!pluginConfig.embedding) return {}
  return {
    CONSULTATION_EMBEDDING_BASE_URL: pluginConfig.embedding.base_url,
    CONSULTATION_EMBEDDING_API_KEY_ENV: pluginConfig.embedding.api_key_env,
    CONSULTATION_EMBEDDING_MODEL: pluginConfig.embedding.model,
    CONSULTATION_EMBEDDING_DIMENSIONS: String(pluginConfig.embedding.dimensions),
  }
}

/**
 * Register the `consultation-memory` local MCP server into the OpenCode
 * config.
 *
 * The command is `[bunExecutable, serverEntry]`. The environment carries
 * `CONSULTATION_NAMESPACE` and, when the plugin config has an `embedding`
 * block, the four `CONSULTATION_EMBEDDING_*` passthrough variables.
 */
export function registerMemoryMcp(
  config: MutableConfig,
  pluginConfig: ConsultationPluginConfig,
  namespace: string,
): void {
  const bun = resolveBunExecutable()
  const serverEntry = resolveMemoryMcpServerEntry()

  const environment: Record<string, string> = {
    CONSULTATION_NAMESPACE: namespace,
    ...buildEmbeddingEnv(pluginConfig),
  }

  const entry: McpLocalEntry = {
    type: "local",
    command: [bun, serverEntry],
    enabled: true,
    environment,
  }

  if (!config.mcp) config.mcp = {}
  config.mcp["consultation-memory"] = entry
}
