import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"

/**
 * Zod schema for the consultation-agent plugin config.
 *
 * Loaded from `$CONSULTATION_CONFIG` or
 * `$XDG_CONFIG_HOME/consultation-agent/config.jsonc` or
 * `~/.config/consultation-agent/config.jsonc`.
 */
const roleCapsSchema = z.object({
  explorer: z.number().int().min(0),
  analyst: z.number().int().min(0),
  critic: z.number().int().min(0),
  verifier: z.number().int().min(0),
})

export const ConsultationPluginConfigSchema = z.object({
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

export type ConsultationPluginConfig = z.infer<typeof ConsultationPluginConfigSchema>

export const MODEL_DEFAULTS = {
  consultant: "deepseek/deepseek-v4-pro",
  explorer: "deepseek/deepseek-v4-flash",
  analyst: "opencode-go/qwen3.7-max",
  critic: "opencode-go/glm-5.2",
  verifier: "opencode-go/qwen3.7-max",
} as const

export type ModelRole = keyof typeof MODEL_DEFAULTS

export function resolveRoleModel(config: ConsultationPluginConfig, role: ModelRole): string {
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
  }
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
  fast: { explorer: 5, analyst: 0, critic: 0, verifier: 0 },
  standard: { explorer: 5, analyst: 1, critic: 1, verifier: 1 },
  deep: { explorer: 5, analyst: 3, critic: 2, verifier: 2 },
}

export const COST_GUARD_USD_DEFAULT = 10

export function resolveTeamCaps(config: ConsultationPluginConfig): TeamCapsConfig {
  const caps = config.team_caps
  return {
    round_cap: caps?.round_cap ?? TEAM_CAPS_DEFAULTS.round_cap,
    explorer_cap: caps?.explorer_cap ?? TEAM_CAPS_DEFAULTS.explorer_cap,
    critic_search_cap: caps?.critic_search_cap ?? TEAM_CAPS_DEFAULTS.critic_search_cap,
  }
}

export function resolveTierRoleCaps(config: ConsultationPluginConfig): TierRoleCapsConfig {
  const tiers = config.tier_role_caps
  return {
    fast: tiers?.fast ?? TIER_ROLE_CAPS_DEFAULTS.fast,
    standard: tiers?.standard ?? TIER_ROLE_CAPS_DEFAULTS.standard,
    deep: tiers?.deep ?? TIER_ROLE_CAPS_DEFAULTS.deep,
  }
}

export function resolveCostGuardUsd(config: ConsultationPluginConfig): number {
  return config.cost_guard_provider_usd ?? COST_GUARD_USD_DEFAULT
}

/**
 * Strip JSONC comments (`//` line and `/* *​/` block) and trailing commas
 * from a JSONC text so it can be parsed by `JSON.parse`.
 *
 * String contents are preserved: comment-like sequences inside string
 * values are not stripped. Comments are removed first, then trailing
 * commas are removed from the comment-free text, so a comma separated
 * from its closing brace by a comment is still caught.
 */
export function stripJsonc(text: string): string {
  return stripTrailingCommas(stripComments(text))
}

function stripComments(text: string): string {
  let result = ""
  let i = 0
  let inString = false

  while (i < text.length) {
    const ch = text[i]

    if (inString) {
      result += ch
      if (ch === "\\") {
        if (i + 1 < text.length) {
          result += text[i + 1]
          i += 2
          continue
        }
      }
      if (ch === '"') {
        inString = false
      }
      i++
      continue
    }

    if (ch === '"') {
      inString = true
      result += ch
      i++
      continue
    }

    if (ch === "/" && i + 1 < text.length && text[i + 1] === "/") {
      i += 2
      while (i < text.length && text[i] !== "\n") i++
      continue
    }

    if (ch === "/" && i + 1 < text.length && text[i + 1] === "*") {
      i += 2
      while (i < text.length && !(text[i] === "*" && i + 1 < text.length && text[i + 1] === "/")) {
        i++
      }
      i += 2
      continue
    }

    result += ch
    i++
  }

  return result
}

function stripTrailingCommas(text: string): string {
  let result = ""
  let i = 0
  let inString = false

  while (i < text.length) {
    const ch = text[i]

    if (inString) {
      result += ch
      if (ch === "\\") {
        if (i + 1 < text.length) {
          result += text[i + 1]
          i += 2
          continue
        }
      }
      if (ch === '"') {
        inString = false
      }
      i++
      continue
    }

    if (ch === '"') {
      inString = true
      result += ch
      i++
      continue
    }

    if (ch === ",") {
      let j = i + 1
      while (j < text.length && /\s/.test(text[j] ?? "")) j++
      if (j < text.length && (text[j] === "}" || text[j] === "]")) {
        i++
        continue
      }
    }

    result += ch
    i++
  }

  return result
}

/**
 * Resolve the plugin config file path from environment variables.
 *
 * Priority: `$CONSULTATION_CONFIG` >
 * `$XDG_CONFIG_HOME/consultation-agent/config.jsonc` >
 * `~/.config/consultation-agent/config.jsonc`.
 *
 * Returns `undefined` when no path can be derived (no HOME and no
 * XDG_CONFIG_HOME and no CONSULTATION_CONFIG).
 */
export function resolvePluginConfigPath(env: NodeJS.ProcessEnv): string | undefined {
  if (env.CONSULTATION_CONFIG && env.CONSULTATION_CONFIG.length > 0) {
    return env.CONSULTATION_CONFIG
  }
  const xdg = env.XDG_CONFIG_HOME
  if (xdg && xdg.length > 0) {
    return join(xdg, "consultation-agent", "config.jsonc")
  }
  const home = env.HOME
  if (!home || home.length === 0) return undefined
  return join(home, ".config", "consultation-agent", "config.jsonc")
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  at ${issue.path.join(".")}: ${issue.message}`)
    .join("\n")
}

/**
 * Load and validate the consultation-agent plugin config.
 *
 * A missing config file is tolerated and yields the schema defaults.
 * An invalid config (unparseable JSON or failed zod validation) throws
 * an `Error` with a message that names the config file path.
 */
export async function loadPluginConfig(env: NodeJS.ProcessEnv): Promise<ConsultationPluginConfig> {
  const configPath = resolvePluginConfigPath(env)

  if (!configPath) {
    return ConsultationPluginConfigSchema.parse({})
  }

  let rawText: string
  try {
    rawText = await readFile(configPath, "utf8")
  } catch {
    return ConsultationPluginConfigSchema.parse({})
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(stripJsonc(rawText))
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    throw new Error(`consultation-agent config: invalid JSON in ${configPath}: ${detail}`)
  }

  const result = ConsultationPluginConfigSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(
      `consultation-agent config: invalid configuration in ${configPath}:\n${formatZodError(result.error)}`,
    )
  }

  return result.data
}
