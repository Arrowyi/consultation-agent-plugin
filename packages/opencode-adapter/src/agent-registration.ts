import { mkdirSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { resolveAsset } from "./asset-paths.ts"
import {
  resolveCostGuardUsd,
  resolveRoleModel,
  resolveRoleModelChain,
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

const SIMPLE_DESCRIPTION =
  "Economical daily-consultation agent (DeepSeek V4.1-Flash by default) for lightweight Q&A, fact and concept lookups, and simple how-to finding. Full read access and web search; escalates complex, high-risk, or evidence-heavy questions to the consultant. Also dispatchable by the consultant for bounded simple-consultation and search subtasks."

const BUILD_LITE_DESCRIPTION =
  "Cheap mechanical coding executor (GLM-5.3-Flash by default) for fully specified, decision-free, mechanically repeatable coding tasks: batch renames/moves, copy-adapt from existing in-repo patterns, formatting and lint fixes, boilerplate from explicit templates, simple tests following existing patterns, spec-complete CRUD glue. Stops and reports up on anything ambiguous, judgment-heavy, debugging, protocol-precision, cross-module, or security-sensitive — never attempts them."

interface BuildLiteAgentEntry {
  mode: "subagent"
  description: string
  prompt: string
  model: string
  steps: number
  permission: Record<string, unknown>
}

export const SIMPLE_BASH_READONLY_RULES: Record<string, "allow"> = {
  ls: "allow",
  "ls *": "allow",
  pwd: "allow",
  "echo *": "allow",
  "cat *": "allow",
  "head *": "allow",
  "tail *": "allow",
  "wc *": "allow",
  "file *": "allow",
  "stat *": "allow",
  "du *": "allow",
  "df *": "allow",
  "which *": "allow",
  whoami: "allow",
  id: "allow",
  date: "allow",
  "date *": "allow",
  uname: "allow",
  "uname *": "allow",
  printenv: "allow",
  "printenv *": "allow",
  "git status": "allow",
  "git status *": "allow",
  "git log": "allow",
  "git log *": "allow",
  "git diff": "allow",
  "git diff *": "allow",
  "git show": "allow",
  "git show *": "allow",
}

interface AllModeAgentEntry {
  mode: "all"
  description: string
  prompt: string
  model: string
  permission: Record<string, unknown>
}

/**
 * Resolve simple's pre-approved writable workspace directory:
 * `simple_workspace_dir` config > `$XDG_DATA_HOME/consultation-agent/simple`
 * > `$HOME/.local/share/consultation-agent/simple`.
 */
export function resolveSimpleWorkspaceDir(
  pluginConfig: ConsultationPluginConfig,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (pluginConfig.simple_workspace_dir !== undefined) return pluginConfig.simple_workspace_dir
  const home = env.HOME !== undefined && env.HOME.length > 0 ? env.HOME : homedir()
  const dataHome =
    env.XDG_DATA_HOME !== undefined && env.XDG_DATA_HOME.length > 0
      ? env.XDG_DATA_HOME
      : join(home, ".local", "share")
  return join(dataHome, "consultation-agent", "simple")
}

/**
 * simple's permissions: read tools allowed, its own workspace writable
 * without asking, everything else asks. Pattern objects put the `"*"`
 * catch-all first (last matching rule wins).
 */
export function buildSimplePermission(workspaceDir: string): Record<string, unknown> {
  return {
    webfetch: "allow",
    websearch: "allow",
    edit: { "*": "ask", [`${workspaceDir}/**`]: "allow" },
    bash: { "*": "ask", ...SIMPLE_BASH_READONLY_RULES },
    external_directory: { [`${workspaceDir}/**`]: "allow" },
  }
}

/**
 * Build the runtime bindings block injected into the simple agent prompt.
 * Reports the memory MCP server, simple's model, the explorer binding,
 * the dispatch job-tool discipline, the pre-approved workspace, and the
 * memory namespace.
 */
export function buildSimpleRuntimeBindings(
  pluginConfig: ConsultationPluginConfig,
  workspaceDir: string,
  namespace: string,
): string {
  const memoryLine = pluginConfig.memory_enabled
    ? "- Memory MCP server name: `consultation-memory` (tools: memory_recall, memory_expand, memory_prepare, memory_commit, memory_manage)"
    : "- Memory: DISABLED by configuration (saving and recall are unavailable)"

  const modelLine = `- Simple model: \`${resolveRoleModel(pluginConfig, "simple")}\``

  const explorerLine = `- Explorer: \`${pluginConfig.explorer_agent}\` (\`${resolveRoleModel(pluginConfig, "explorer")}\`) — dispatch via \`consultation_dispatch\` (role="explorer", prompt) for multi-source graded retrieval`

  const buildLiteLine = pluginConfig.build_lite_enabled
    ? `- Mechanical coding lane: \`${pluginConfig.build_lite_agent}\` (\`${resolveRoleModel(pluginConfig, "build-lite")}\`) for fully specified mechanical coding and file tasks`
    : "- Mechanical coding lane: build-lite DISABLED by configuration"
  const buildLine = pluginConfig.build_enabled
    ? `- Strong coding lane: role \`build\` routes to agent \`${pluginConfig.build_agent}\` (\`${pluginConfig.build_model ?? "host default model"}\`) for judgment-heavy coding`
    : "- Strong coding lane: build DISABLED by configuration"

  const dispatchLine =
    "- Job tools: `consultation_dispatch` (role, prompt) uses a soft wait; pending/unknown is not failure. Continue the same job with `consultation_dispatch_wait` (job_id, wait_ms?; integer 0..300000, default 300000; 0 snapshots). Only `consultation_dispatch_cancel` (job_id) requests cancellation; cancelling is not confirmed cancellation."

  const workspaceLine = `- Your writable workspace: \`${workspaceDir}\` — the only location where creating files is pre-approved; every other write asks first`

  const namespaceLine = `- Memory namespace: \`${namespace}\``

  return `## Runtime Bindings (injected by opencode-adapter)\n${memoryLine}\n${modelLine}\n${explorerLine}\n${buildLiteLine}\n${buildLine}\n${dispatchLine}\n${workspaceLine}\n${namespaceLine}`
}

/**
 * Register the `simple` agent (mode "all": user-selectable primary AND
 * dispatchable subagent). Reads `assets/agents/simple.md`, injects the
 * runtime bindings block, attempts to create the workspace directory
 * (non-fatal), and never clobbers a pre-existing user-defined entry.
 */
export async function registerSimple(
  config: MutableConfig,
  pluginConfig: ConsultationPluginConfig,
  namespace: string,
): Promise<void> {
  if (config.agent?.[pluginConfig.simple_agent]) return

  const workspaceDir = resolveSimpleWorkspaceDir(pluginConfig)
  try {
    mkdirSync(workspaceDir, { recursive: true })
  } catch {
    // Non-fatal: the permission pattern still ships; writes there may fail.
  }

  const body = await readFile(resolveAsset("agents/simple.md"), "utf8")
  const modelBlock = await resolveModelPrompt(pluginConfig, resolveRoleModel(pluginConfig, "simple"))
  const withModelPrompt = injectModelPrompt(body, modelBlock)
  const runtimeBlock = buildSimpleRuntimeBindings(pluginConfig, workspaceDir, namespace)
  const assembledPrompt = injectRuntimeBindings(withModelPrompt, runtimeBlock)

  const entry: AllModeAgentEntry = {
    mode: "all",
    description: SIMPLE_DESCRIPTION,
    prompt: assembledPrompt,
    model: resolveRoleModel(pluginConfig, "simple"),
    permission: buildSimplePermission(workspaceDir),
  }

  if (!config.agent) config.agent = {}
  config.agent[pluginConfig.simple_agent] = entry
}

/**
 * build-lite's permissions: workspace edits allowed without asking (the edit
 * resource is location-relative for workspace paths, so "*" matches them and
 * the later "/*" rule only matches external absolute paths), external edits
 * ask, read-only bash allowed, everything else asks, and further subagent
 * dispatch is denied (leaf node).
 */
export function buildBuildLitePermission(): Record<string, unknown> {
  return {
    edit: { "*": "allow", "/*": "ask" },
    bash: { "*": "ask", ...SIMPLE_BASH_READONLY_RULES },
    webfetch: "allow",
    websearch: "allow",
    task: "deny",
  }
}

/**
 * Register the `build-lite` mechanical coding lane: mode "subagent", a static
 * prompt (leaf node — never dispatches, so no runtime bindings block), a
 * step cap of 50 with report-up, and the workspace-allow permission set.
 * A pre-existing user-defined entry under the same name is left untouched.
 */
export async function registerBuildLite(
  config: MutableConfig,
  pluginConfig: ConsultationPluginConfig,
): Promise<void> {
  if (config.agent?.[pluginConfig.build_lite_agent]) return

  const body = await readFile(resolveAsset("agents/build-lite.md"), "utf8")
  const modelBlock = await resolveModelPrompt(pluginConfig, resolveRoleModel(pluginConfig, "build-lite"))
  const prompt = injectModelPrompt(body, modelBlock)

  const entry: BuildLiteAgentEntry = {
    mode: "subagent",
    description: BUILD_LITE_DESCRIPTION,
    prompt,
    model: resolveRoleModel(pluginConfig, "build-lite"),
    steps: 50,
    permission: buildBuildLitePermission(),
  }

  if (!config.agent) config.agent = {}
  config.agent[pluginConfig.build_lite_agent] = entry
}

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

  const simpleLine = pluginConfig.simple_enabled
    ? `- Economical generalist: \`${pluginConfig.simple_agent}\` (\`${resolveRoleModel(pluginConfig, "simple")}\`) for bounded simple-consultation and search tasks`
    : "- Economical generalist: simple DISABLED by configuration"

  const buildLiteLine = pluginConfig.build_lite_enabled
    ? `- Mechanical coding lane: \`${pluginConfig.build_lite_agent}\` (\`${resolveRoleModel(pluginConfig, "build-lite")}\`) for fully specified mechanical coding and file tasks`
    : "- Mechanical coding lane: build-lite DISABLED by configuration"
  const buildLine = pluginConfig.build_enabled
    ? `- Strong coding lane: role \`build\` routes to agent \`${pluginConfig.build_agent}\` (\`${pluginConfig.build_model ?? "host default model"}\`) for judgment-heavy coding`
    : "- Strong coding lane: build DISABLED by configuration"

  const caps = resolveTeamCaps(pluginConfig)
  const tiers = resolveTierRoleCaps(pluginConfig)
  const costGuard = resolveCostGuardUsd(pluginConfig)

  const capsLine = `- Team maximums (not targets): round_cap=${caps.round_cap}, explorer<=${caps.explorer_cap}, critic_searches<=${caps.critic_search_cap} per round`
  const tierMatrixLine = `- Tier role maximums (not a required roster): fast(e${tiers.fast.explorer},a${tiers.fast.analyst},c${tiers.fast.critic},v${tiers.fast.verifier},w${tiers.fast.writer}) standard(e${tiers.standard.explorer},a${tiers.standard.analyst},c${tiers.standard.critic},v${tiers.standard.verifier},w${tiers.standard.writer}) deep(e${tiers.deep.explorer},a${tiers.deep.analyst},c${tiers.deep.critic},v${tiers.deep.verifier},w${tiers.deep.writer})`
  const costLine = `- Cost guard: ~$${costGuard} per provider (advisory, converge when approaching)`

  const namespaceLine = `- Memory namespace: \`${namespace}\``
  const dispatchLine = "- Job tools: `consultation_dispatch` (role, prompt) uses a soft wait; pending/unknown is not failure. Continue the same job with `consultation_dispatch_wait` (job_id, wait_ms?; integer 0..300000, default 300000; 0 snapshots). Only `consultation_dispatch_cancel` (job_id) requests cancellation; cancelling is not confirmed cancellation."

  return `## Runtime Bindings (injected by opencode-adapter)\n${memoryLine}\n${consultantModelLine}\n${teamLine}\n${simpleLine}\n${buildLiteLine}\n${buildLine}\n${dispatchLine}\n${capsLine}\n${tierMatrixLine}\n${costLine}\n${namespaceLine}`
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
 * Convert a model id ("provider/model") into the file-slug form used by the
 * shipped model-prompt library (`assets/model-prompts/<slug>.md`).
 */
export function modelSlug(modelId: string): string {
  return modelId.replaceAll("/", "-")
}

/**
 * Resolve the model-adaptation block for a model, keyed by the model itself
 * and decoupled from the agent: the user's global `model_prompts` map wins
 * (exact resolved-model id keys; an explicit "" disables that model's
 * block), else the shipped `assets/model-prompts/<slug>.md` block if a file
 * for the model exists, else empty.
 */
export async function resolveModelPrompt(
  pluginConfig: ConsultationPluginConfig,
  resolvedModel: string,
): Promise<string> {
  const override = pluginConfig.model_prompts?.[resolvedModel]
  if (override !== undefined) return override
  try {
    return await readFile(resolveAsset(`model-prompts/${modelSlug(resolvedModel)}.md`), "utf8")
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

  const modelBlock = await resolveModelPrompt(pluginConfig, resolveRoleModel(pluginConfig, "consultant"))
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
  },
): Promise<void> {
  if (config.agent?.[options.name]) return

  const modelBlock = await resolveModelPrompt(options.pluginConfig, options.model)
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
  })
}
