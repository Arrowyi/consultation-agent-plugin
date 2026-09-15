import { readFile } from "node:fs/promises"
import { resolveAsset } from "./asset-paths.ts"
import {
  resolveCostGuardUsd,
  resolveRoleModel,
  resolveTeamCaps,
  resolveTierRoleCaps,
  type ConsultationPluginConfig,
} from "./plugin-config.ts"

interface MutableConfig {
  agent?: Record<string, unknown>
}

interface ConsultantAgentEntry {
  mode: "primary"
  prompt: string
  model: string
}

interface SubagentEntry {
  mode: "subagent"
  description: string
  prompt: string
  model: string
  permission: { edit: string }
}

const RUNTIME_BINDINGS_PLACEHOLDER = /<!--\s*RUNTIME-BINDINGS[\s\S]*?-->/

const EXPLORER_DESCRIPTION =
  "Search and information-gathering specialist. Gathers graded sources for specific claims and returns a structured report. Dispatched by the consultant and may fan out to multiple instances."

const ANALYST_DESCRIPTION =
  "Independent cross-model analyst. Reasons over gathered evidence per claim and returns a structured analysis. Dispatched by the consultant for standard and deep consultations."

const CRITIC_DESCRIPTION =
  "Adversarial counter-evidence reviewer. Independently searches for opposing, qualifying, and superseding sources, challenges the leading conclusion, and returns a structured critique. Dispatched by the consultant for standard and deep consultations."

const VERIFIER_DESCRIPTION =
  "Intent-audit specialist. Audits user-generated sources for deliberate deception (paid shilling, coordinated smear campaigns, astroturfing) using text, account, temporal, rating-distribution, and platform-marker signals, and returns per-source intent annotations. Dispatched by the consultant for select and verify consultations at standard and deep tiers."

/**
 * Build the runtime bindings block that the adapter injects into the
 * consultant agent prompt.
 *
 * Reports: the memory MCP server (or DISABLED), the consultant model, the
 * team subagents with their models, and the memory namespace.
 */
export function buildRuntimeBindings(
  pluginConfig: ConsultationPluginConfig,
  namespace: string,
): string {
  const memoryLine = pluginConfig.memory_enabled
    ? "- Memory MCP server name: `consultation-memory` (tools: memory_recall, memory_expand, memory_prepare, memory_commit, memory_manage)"
    : "- Memory: DISABLED by configuration (saving and recall are unavailable)"

  const consultantModelLine = `- Consultant model: \`${resolveRoleModel(pluginConfig, "consultant")}\``

  const roleParts = [
    `explorer \`${pluginConfig.explorer_agent}\` (${resolveRoleModel(pluginConfig, "explorer")})`,
    `analyst \`${pluginConfig.analyst_agent}\` (${resolveRoleModel(pluginConfig, "analyst")})`,
  ]
  roleParts.push(
    pluginConfig.critic_enabled
      ? `critic \`${pluginConfig.critic_agent}\` (${resolveRoleModel(pluginConfig, "critic")})`
      : "critic DISABLED by configuration",
  )
  roleParts.push(
    pluginConfig.verifier_enabled
      ? `verifier \`${pluginConfig.verifier_agent}\` (${resolveRoleModel(pluginConfig, "verifier")})`
      : "verifier DISABLED by configuration",
  )
  const teamLine = `- Team subagents: ${roleParts.join(", ")}`

  const caps = resolveTeamCaps(pluginConfig)
  const tiers = resolveTierRoleCaps(pluginConfig)
  const costGuard = resolveCostGuardUsd(pluginConfig)

  const capsLine = `- Team caps: round_cap=${caps.round_cap}, explorer<=${caps.explorer_cap}, critic_searches<=${caps.critic_search_cap} per round`
  const tierMatrixLine = `- Tier role caps: fast(e${tiers.fast.explorer},a${tiers.fast.analyst},c${tiers.fast.critic},v${tiers.fast.verifier}) standard(e${tiers.standard.explorer},a${tiers.standard.analyst},c${tiers.standard.critic},v${tiers.standard.verifier}) deep(e${tiers.deep.explorer},a${tiers.deep.analyst},c${tiers.deep.critic},v${tiers.deep.verifier})`
  const costLine = `- Cost guard: ~$${costGuard} per provider (advisory, converge when approaching)`

  const namespaceLine = `- Memory namespace: \`${namespace}\``

  return `## Runtime Bindings (injected by opencode-adapter)\n${memoryLine}\n${consultantModelLine}\n${teamLine}\n${capsLine}\n${tierMatrixLine}\n${costLine}\n${namespaceLine}`
}

/**
 * Inject the runtime bindings block into the consultant prompt body.
 *
 * If the body contains a `<!-- RUNTIME-BINDINGS ... -->` placeholder
 * comment, it is replaced by the block. Otherwise the block is appended
 * at the end of the body.
 */
export function injectRuntimeBindings(body: string, runtimeBlock: string): string {
  if (RUNTIME_BINDINGS_PLACEHOLDER.test(body)) {
    return body.replace(RUNTIME_BINDINGS_PLACEHOLDER, runtimeBlock)
  }
  return body + "\n\n" + runtimeBlock
}

/**
 * Register the `consultant` primary agent into the OpenCode config.
 *
 * Reads `assets/agents/consultant.md`, injects the runtime bindings block,
 * and sets `config.agent["consultant"]` with `mode: "primary"` and the
 * resolved consultant model. A pre-existing user-defined `consultant` agent
 * entry is left untouched (never clobbered).
 */
export async function registerConsultantAgent(
  config: MutableConfig,
  pluginConfig: ConsultationPluginConfig,
  namespace: string,
): Promise<void> {
  if (config.agent?.["consultant"]) return

  const consultantPath = resolveAsset("agents/consultant.md")
  const consultantBody = await readFile(consultantPath, "utf8")

  const runtimeBlock = buildRuntimeBindings(pluginConfig, namespace)
  const assembledPrompt = injectRuntimeBindings(consultantBody, runtimeBlock)

  const entry: ConsultantAgentEntry = {
    mode: "primary",
    prompt: assembledPrompt,
    model: resolveRoleModel(pluginConfig, "consultant"),
  }

  if (!config.agent) config.agent = {}
  config.agent["consultant"] = entry
}

/**
 * Register a read-only team subagent. Reads the role asset, sets
 * `mode: "subagent"`, a fixed model, a description, and a `permission.edit`
 * of "deny" so the role can gather and critique but never edit. A
 * pre-existing user-defined entry under the same name is left untouched.
 */
async function registerReadOnlySubagent(
  config: MutableConfig,
  options: { name: string; description: string; assetFile: string; model: string },
): Promise<void> {
  if (config.agent?.[options.name]) return

  const body = await readFile(resolveAsset(options.assetFile), "utf8")

  const entry: SubagentEntry = {
    mode: "subagent",
    description: options.description,
    prompt: body,
    model: options.model,
    permission: { edit: "deny" },
  }

  if (!config.agent) config.agent = {}
  config.agent[options.name] = entry
}

export async function registerExplorer(
  config: MutableConfig,
  pluginConfig: ConsultationPluginConfig,
): Promise<void> {
  await registerReadOnlySubagent(config, {
    name: pluginConfig.explorer_agent,
    description: EXPLORER_DESCRIPTION,
    assetFile: "agents/explorer.md",
    model: resolveRoleModel(pluginConfig, "explorer"),
  })
}

export async function registerAnalyst(
  config: MutableConfig,
  pluginConfig: ConsultationPluginConfig,
): Promise<void> {
  await registerReadOnlySubagent(config, {
    name: pluginConfig.analyst_agent,
    description: ANALYST_DESCRIPTION,
    assetFile: "agents/analyst.md",
    model: resolveRoleModel(pluginConfig, "analyst"),
  })
}

export async function registerConsultationCritic(
  config: MutableConfig,
  pluginConfig: ConsultationPluginConfig,
): Promise<void> {
  await registerReadOnlySubagent(config, {
    name: pluginConfig.critic_agent,
    description: CRITIC_DESCRIPTION,
    assetFile: "agents/consultation-critic.md",
    model: resolveRoleModel(pluginConfig, "critic"),
  })
}

export async function registerVerifier(
  config: MutableConfig,
  pluginConfig: ConsultationPluginConfig,
): Promise<void> {
  await registerReadOnlySubagent(config, {
    name: pluginConfig.verifier_agent,
    description: VERIFIER_DESCRIPTION,
    assetFile: "agents/consultation-verifier.md",
    model: resolveRoleModel(pluginConfig, "verifier"),
  })
}
