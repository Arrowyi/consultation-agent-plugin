import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"

import { stripJsonc } from "./jsonc.ts"

export { stripJsonc }

/**
 * Zod schema for the janus-agent plugin config.
 *
 * Loaded from `$JANUS_CONFIG` or
 * `$XDG_CONFIG_HOME/janus-agent/config.jsonc` or
 * `~/.config/janus-agent/config.jsonc`.
 */
const roleCapsSchema = z.object({
  explorer: z.number().int().min(0),
  analyst: z.number().int().min(0),
  critic: z.number().int().min(0),
  verifier: z.number().int().min(0),
  writer: z.number().int().min(0).default(0),
})

export const JanusPluginConfigSchema = z.object({
  agent_model: z.string().optional(),
  critic_agent: z.string().default("consultation-critic"),
  critic_model: z.string().optional(),
  critic_enabled: z.boolean().default(true),
  verifier_agent: z.string().default("consultation-verifier"),
  verifier_model: z.string().optional(),
  verifier_enabled: z.boolean().default(true),
  explorer_agent: z.string().default("consultation-explorer"),
  explorer_model: z.string().optional(),
  analyst_agent: z.string().default("consultation-analyst"),
  analyst_model: z.string().optional(),
  writer_agent: z.string().default("consultation-writer"),
  writer_model: z.string().optional(),
  writer_enabled: z.boolean().default(true),
  writer_delegate_agent: z.string().optional(),
  writer_delegate_model: z.string().optional(),
  coder_agent: z.string().default("coder"),
  coder_model: z.string().optional(),
  coder_enabled: z.boolean().default(true),
  lite_agent: z.string().default("lite"),
  lite_model: z.string().optional(),
  lite_enabled: z.boolean().default(true),
  lite_workspace_dir: z.string().min(1).optional(),
  coder_lite_agent: z.string().default("coder-lite"),
  coder_lite_model: z.string().optional(),
  coder_lite_enabled: z.boolean().default(true),
  build_agent: z.string().default("build"),
  build_model: z.string().optional(),
  build_enabled: z.boolean().default(true),
  janus_agent: z.string().default("janus"),
  janus_model: z.string().optional(),
  janus_enabled: z.boolean().default(true),
  // Global model-adaptation prompt map, keyed by the provider-agnostic
  // normalized model key (see normalizeModelKey: provider prefix stripped,
  // lowercased, alphanumerics only). An explicit "" disables that model's
  // block; the plugin otherwise falls back to its shipped
  // assets/model-prompts library.
  model_prompts: z.record(z.string()).optional(),
  team_caps: z
    .object({
      round_cap: z.number().int().positive(),
      explorer_cap: z.number().int().positive(),
      critic_search_cap: z.number().int().positive(),
    })
    .optional(),
  tier_role_caps: z
    .object({
      fast: roleCapsSchema,
      standard: roleCapsSchema,
      deep: roleCapsSchema,
    })
    .optional(),
  cost_guard_provider_usd: z.number().positive().optional(),
  install_skill: z.boolean().default(true),
  install_commands: z.boolean().default(true),
  memory_enabled: z.boolean().default(true),
  embedding: z
    .object({
      base_url: z.string(),
      api_key_env: z.string(),
      model: z.string(),
      dimensions: z.number(),
    })
    .optional(),
})

export type JanusPluginConfig = z.infer<typeof JanusPluginConfigSchema>

// Cross-family audit structure: challenger (gemini) ≠ consultant (glm) ≠
// analyst (qwen), so the challenge roles never share a model family with the
// roles they audit — independent audit is restored. critic and verifier share
// gemini-3.8-flash (judgment ceiling: GPQA 95.3 / HLE 47.8 / ARC-AGI-2 89.2),
// running on Zen pay-per-use ($1.50/$7.50) rather than a Go pool — accepted
// because they are read-only, low-frequency challenge roles (tier caps: fast
// 0 / standard 1 / deep 2), where judgment quality outranks pool accounting.
// consultant runs glm-5.3 (TB4.0 41.8%, strongest hard-agentic; the previous
// deepseek-v4-pro default was EOL-tracked — DeepSeek routes it to V4.1-Flash).
// consultant and explorer route through `opencode-go` so a Go/Go Plus
// subscription allowance absorbs their usage (DeepSeek is served there at the
// same price as the direct API, with a monthly per-model allowance).
// analyst is qwen3.8-max (qwen3.7-max was retired from Go). explorer and
// lite share deepseek-v4.1-flash. writer is claude-sonnet-5-5 (TB4.0 70.6%
// vs 5's 12.4% — the previous claude-sonnet-5 default's reputation collapsed)
// and, like every role, resolves to a single model with no fallback.
// lite is the economical quick-answer entry on V4.1-Flash. coder is the
// judgment-heavy coding entry, defaulting to the same strong agentic model as
// the consultant; coder-lite is the mechanical lane on GLM-5.3-Flash
// (agentic-strong at half of V4.1-Flash's peak price). The build role targets
// the host's native build agent by name and has no plugin default model.
export const MODEL_DEFAULTS = {
  consultant: "opencode-go/glm-5.3",
  explorer: "opencode-go/deepseek-v4.1-flash",
  analyst: "opencode-go/qwen3.8-max",
  critic: "opencode/gemini-3.8-flash",
  verifier: "opencode/gemini-3.8-flash",
  writer: "opencode/claude-sonnet-5-5",
  coder: "opencode-go/glm-5.3",
  lite: "opencode-go/deepseek-v4.1-flash",
  "coder-lite": "opencode-go/glm-5.3-flash",
  janus: "opencode-go/glm-5.3",
} as const

export type ModelRole = keyof typeof MODEL_DEFAULTS

export function resolveRoleModel(config: JanusPluginConfig, role: ModelRole): string {
  switch (role) {
    case "consultant":
      return config.agent_model ?? MODEL_DEFAULTS.consultant
    case "explorer":
      return config.explorer_model ?? MODEL_DEFAULTS.explorer
    case "analyst":
      return config.analyst_model ?? MODEL_DEFAULTS.analyst
    case "critic":
      return config.critic_model ?? MODEL_DEFAULTS.critic
    case "verifier":
      return config.verifier_model ?? MODEL_DEFAULTS.verifier
    case "writer":
      return config.writer_model ?? MODEL_DEFAULTS.writer
    case "coder":
      return config.coder_model ?? MODEL_DEFAULTS.coder
    case "lite":
      return config.lite_model ?? MODEL_DEFAULTS.lite
    case "coder-lite":
      return config.coder_lite_model ?? MODEL_DEFAULTS["coder-lite"]
    case "janus":
      return config.janus_model ?? MODEL_DEFAULTS.janus
  }
}

export function resolveRoleModelChain(config: JanusPluginConfig, role: ModelRole): string[] {
  return [resolveRoleModel(config, role)]
}

export interface TeamCapsConfig {
  round_cap: number
  explorer_cap: number
  critic_search_cap: number
}

export interface RoleCapsConfig {
  explorer: number
  analyst: number
  critic: number
  verifier: number
  writer: number
}

export interface TierRoleCapsConfig {
  fast: RoleCapsConfig
  standard: RoleCapsConfig
  deep: RoleCapsConfig
}

export const TEAM_CAPS_DEFAULTS: TeamCapsConfig = {
  round_cap: 3,
  explorer_cap: 5,
  critic_search_cap: 5,
}

export const TIER_ROLE_CAPS_DEFAULTS: TierRoleCapsConfig = {
  fast: { explorer: 5, analyst: 0, critic: 0, verifier: 0, writer: 0 },
  standard: { explorer: 5, analyst: 1, critic: 1, verifier: 1, writer: 1 },
  deep: { explorer: 5, analyst: 3, critic: 2, verifier: 2, writer: 2 },
}

export const COST_GUARD_USD_DEFAULT = 10

export function resolveTeamCaps(config: JanusPluginConfig): TeamCapsConfig {
  const caps = config.team_caps
  return {
    round_cap: caps?.round_cap ?? TEAM_CAPS_DEFAULTS.round_cap,
    explorer_cap: caps?.explorer_cap ?? TEAM_CAPS_DEFAULTS.explorer_cap,
    critic_search_cap: caps?.critic_search_cap ?? TEAM_CAPS_DEFAULTS.critic_search_cap,
  }
}

export function resolveTierRoleCaps(config: JanusPluginConfig): TierRoleCapsConfig {
  const tiers = config.tier_role_caps
  return {
    fast: tiers?.fast ?? TIER_ROLE_CAPS_DEFAULTS.fast,
    standard: tiers?.standard ?? TIER_ROLE_CAPS_DEFAULTS.standard,
    deep: tiers?.deep ?? TIER_ROLE_CAPS_DEFAULTS.deep,
  }
}

export function resolveCostGuardUsd(config: JanusPluginConfig): number {
  return config.cost_guard_provider_usd ?? COST_GUARD_USD_DEFAULT
}

/**
 * Resolve the plugin config file path from environment variables.
 *
 * Priority: `$JANUS_CONFIG` >
 * `$XDG_CONFIG_HOME/janus-agent/config.jsonc` >
 * `~/.config/janus-agent/config.jsonc`.
 *
 * Returns `undefined` when no path can be derived (no HOME and no
 * XDG_CONFIG_HOME and no JANUS_CONFIG).
 */
export function resolvePluginConfigPath(env: NodeJS.ProcessEnv): string | undefined {
  if (env.JANUS_CONFIG && env.JANUS_CONFIG.length > 0) {
    return env.JANUS_CONFIG
  }
  const xdg = env.XDG_CONFIG_HOME
  if (xdg && xdg.length > 0) {
    return join(xdg, "janus-agent", "config.jsonc")
  }
  const home = env.HOME
  if (!home || home.length === 0) return undefined
  return join(home, ".config", "janus-agent", "config.jsonc")
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  at ${issue.path.join(".")}: ${issue.message}`)
    .join("\n")
}

/**
 * Load and validate the janus-agent plugin config.
 *
 * A missing config file is tolerated and yields the schema defaults.
 * An invalid config (unparseable JSON or failed zod validation) throws
 * an `Error` with a message that names the config file path.
 */
export async function loadPluginConfig(env: NodeJS.ProcessEnv): Promise<JanusPluginConfig> {
  const configPath = resolvePluginConfigPath(env)

  if (!configPath) {
    return JanusPluginConfigSchema.parse({})
  }

  let rawText: string
  try {
    rawText = await readFile(configPath, "utf8")
  } catch {
    return JanusPluginConfigSchema.parse({})
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(stripJsonc(rawText))
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    throw new Error(`janus-agent config: invalid JSON in ${configPath}: ${detail}`)
  }

  const result = JanusPluginConfigSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(
      `janus-agent config: invalid configuration in ${configPath}:\n${formatZodError(result.error)}`,
    )
  }

  return result.data
}
