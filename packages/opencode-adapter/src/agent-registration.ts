import { readFile } from "node:fs/promises"
import { resolveAsset } from "./asset-paths.ts"
import {
  MODEL_DEFAULTS,
  resolveCostGuardUsd,
  resolveRoleModel,
  resolveRoleModelChain,
  resolveTeamCaps,
  resolveTierRoleCaps,
  type ConsultationPluginConfig,
  type ModelRole,
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
  permission: Record<string, string>
}

const RUNTIME_BINDINGS_PLACEHOLDER = /<!--\s*RUNTIME-BINDINGS[\s\S]*?-->/

const MODEL_PROMPT_PLACEHOLDER = /<!--\s*MODEL-PROMPT[\s\S]*?-->/

const EXPLORER_DESCRIPTION =
  "Search and information-gathering specialist. Gathers graded sources for specific claims and returns a structured report. Dispatched by the consultant and may fan out to multiple instances."

const ANALYST_DESCRIPTION =
  "Independent cross-model analyst. Reasons over gathered evidence when interpretation, conflicting sources, or important trade-offs could change the conclusion; returns a structured analysis."

const CRITIC_DESCRIPTION =
  "Adversarial counter-evidence reviewer. Independently searches for opposing, qualifying, and superseding sources when a consequential conclusion or uncertain plan step needs challenge."

const VERIFIER_DESCRIPTION =
  "Source intent and influence specialist. Audits user reviews, promotional claims, and purportedly independent third-party material when sponsorship, coordination, or provenance is relevant or uncertain; reports observable signals and missing evidence rather than assuming clean."

const WRITER_DESCRIPTION =
  "Read-only writing specialist for author consultations. Produces a blueprint before outline approval, or a substantive section/chapter draft from the approved map and evidence packet after approval; never researches missing facts, executes commands, or writes files."

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
  const writerChain = resolveRoleModelChain(pluginConfig, "writer")
  const writerModelLabel =
    writerChain.length > 1
      ? `${writerChain[0]}, fallback: ${writerChain.slice(1).join(", ")}`
      : `${writerChain[0]}`
  roleParts.push(
    pluginConfig.writer_delegate_agent !== undefined
      ? `writer delegated to \`${pluginConfig.writer_delegate_agent}\``
      : pluginConfig.writer_enabled
        ? `writer \`${pluginConfig.writer_agent}\` (${writerModelLabel})`
        : "writer DISABLED by configuration",
  )
  const teamLine = `- Team subagents: ${roleParts.join(", ")}`

  const caps = resolveTeamCaps(pluginConfig)
  const tiers = resolveTierRoleCaps(pluginConfig)
  const costGuard = resolveCostGuardUsd(pluginConfig)

  const capsLine = `- Team maximums (not targets): round_cap=${caps.round_cap}, explorer<=${caps.explorer_cap}, critic_searches<=${caps.critic_search_cap} per round`
  const tierMatrixLine = `- Tier role maximums (not a required roster): fast(e${tiers.fast.explorer},a${tiers.fast.analyst},c${tiers.fast.critic},v${tiers.fast.verifier},w${tiers.fast.writer}) standard(e${tiers.standard.explorer},a${tiers.standard.analyst},c${tiers.standard.critic},v${tiers.standard.verifier},w${tiers.standard.writer}) deep(e${tiers.deep.explorer},a${tiers.deep.analyst},c${tiers.deep.critic},v${tiers.deep.verifier},w${tiers.deep.writer})`
  const costLine = `- Cost guard: ~$${costGuard} per provider (advisory, converge when approaching)`

  const namespaceLine = `- Memory namespace: \`${namespace}\``
  const dispatchLine = "- Job tools: `consultation_dispatch` (role, prompt) uses a soft wait; pending/unknown is not failure. Continue the same job with `consultation_dispatch_wait` (job_id, wait_ms?; integer 0..300000, default 300000; 0 snapshots). Only `consultation_dispatch_cancel` (job_id) requests cancellation; cancelling is not confirmed cancellation."

  return `## Runtime Bindings (injected by opencode-adapter)\n${memoryLine}\n${consultantModelLine}\n${teamLine}\n${dispatchLine}\n${capsLine}\n${tierMatrixLine}\n${costLine}\n${namespaceLine}`
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
 * Per-agent model-adaptation prompt maps from the plugin config.
 */
function modelPromptsFor(
  pluginConfig: ConsultationPluginConfig,
  role: ModelRole,
): Record<string, string> | undefined {
  switch (role) {
    case "consultant":
      return pluginConfig.agent_model_prompts
    case "explorer":
      return pluginConfig.explorer_model_prompts
    case "analyst":
      return pluginConfig.analyst_model_prompts
    case "critic":
      return pluginConfig.critic_model_prompts
    case "verifier":
      return pluginConfig.verifier_model_prompts
    case "writer":
      return pluginConfig.writer_model_prompts
    case "simple":
      return pluginConfig.simple_model_prompts
    case "build-lite":
      return pluginConfig.build_lite_model_prompts
  }
}

/**
 * Resolve the model-adaptation block for a plugin-owned agent. The user map
 * wins (exact resolved-model id keys; an explicit "" disables). The shipped
 * default `assets/model-prompts/<role>.md` applies only when the resolved
 * model IS the agent's default model — default-model advice is never
 * injected into a swapped model. Otherwise empty.
 */
export async function resolveModelPrompt(
  pluginConfig: ConsultationPluginConfig,
  role: ModelRole,
  resolvedModel: string,
): Promise<string> {
  const override = modelPromptsFor(pluginConfig, role)?.[resolvedModel]
  if (override !== undefined) return override
  if (resolvedModel !== MODEL_DEFAULTS[role]) return ""
  try {
    return await readFile(resolveAsset(`model-prompts/${role}.md`), "utf8")
  } catch {
    return ""
  }
}

/**
 * Inject the model-adaptation block into an agent asset body. An empty block
 * returns the body unchanged (the placeholder comment stays inert), so
 * no-block assembly is byte-identical to the raw asset.
 */
export function injectModelPrompt(body: string, block: string): string {
  if (block.length === 0) return body
  if (MODEL_PROMPT_PLACEHOLDER.test(body)) {
    return body.replace(MODEL_PROMPT_PLACEHOLDER, block)
  }
  return `${body}\n\n## Driving This Model\n\n${block}`
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

  const modelBlock = await resolveModelPrompt(pluginConfig, "consultant", resolveRoleModel(pluginConfig, "consultant"))
  const withModelPrompt = injectModelPrompt(consultantBody, modelBlock)
  const runtimeBlock = buildRuntimeBindings(pluginConfig, namespace)
  const assembledPrompt = injectRuntimeBindings(withModelPrompt, runtimeBlock)

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
  options: {
    name: string
    description: string
    assetFile: string
    model: string
    denyBash?: boolean
    pluginConfig: ConsultationPluginConfig
    role: ModelRole
  },
): Promise<void> {
  if (config.agent?.[options.name]) return

  const modelBlock = await resolveModelPrompt(options.pluginConfig, options.role, options.model)
  const body = injectModelPrompt(await readFile(resolveAsset(options.assetFile), "utf8"), modelBlock)

  const entry: SubagentEntry = {
    mode: "subagent",
    description: options.description,
    prompt: body,
    model: options.model,
    permission: options.denyBash ? { edit: "deny", bash: "deny" } : { edit: "deny" },
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
    pluginConfig,
    role: "explorer",
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
    pluginConfig,
    role: "analyst",
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
    pluginConfig,
    role: "critic",
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
    pluginConfig,
    role: "verifier",
  })
}

export async function registerWriter(
  config: MutableConfig,
  pluginConfig: ConsultationPluginConfig,
): Promise<void> {
  if (pluginConfig.writer_delegate_agent !== undefined) return
  await registerReadOnlySubagent(config, {
    name: pluginConfig.writer_agent,
    description: WRITER_DESCRIPTION,
    assetFile: "agents/writer.md",
    model: resolveRoleModel(pluginConfig, "writer"),
    denyBash: true,
    pluginConfig,
    role: "writer",
  })
}
