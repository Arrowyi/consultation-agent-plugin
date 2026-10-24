import { mkdirSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { resolveAsset } from "./asset-paths.ts"
import {
  resolveCostGuardUsd,
  resolveRoleModel,
  resolveTeamCaps,
  resolveTierRoleCaps,
  type JanusPluginConfig,
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

const LITE_DESCRIPTION =
  "Economical quick-answer entry (DeepSeek V4.1-Flash by default) for low-risk facts, concepts, and simple how-to. A leaf: never dispatches; escalates multi-source/contested questions to the consultant, coding to the coder, and general questions to janus."

const CODER_DESCRIPTION =
  "Coding entry point and execution specialist. Owns coding, debugging, refactoring, tests, and repository work; selects a direct, brief-plan, design-gate, or quality-gate process by task weight; dispatches coder-lite for mechanical work and build for an optional stronger model."

const CODER_LITE_DESCRIPTION =
  "Cheap mechanical coding executor (GLM-5.3-Flash by default) for fully specified, decision-free, mechanically repeatable coding tasks: batch renames/moves, copy-adapt from existing in-repo patterns, formatting and lint fixes, boilerplate from explicit templates, simple tests following existing patterns, spec-complete CRUD glue. Stops and reports up on anything ambiguous, judgment-heavy, debugging, protocol-precision, cross-module, or security-sensitive — never attempts them."

const JANUS_DESCRIPTION =
  "Daily-driver primary and default entry point. Handles general questions, light tasks, and routing: dispatches consultant for evidence work, coder for coding, and lite for quick answers. Does not do deep research or heavy coding itself."

interface CodingLaneEntry {
  mode: "subagent"
  description: string
  prompt: string
  model: string
  steps: number
  permission: Record<string, unknown>
}

export const READONLY_BASH_RULES: Record<string, "allow"> = {
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
 * Resolve lite's pre-approved writable workspace directory:
 * `lite_workspace_dir` > `$XDG_DATA_HOME/janus-agent/lite` >
 * `$HOME/.local/share/janus-agent/lite`.
 */
export function resolveLiteWorkspaceDir(
  pluginConfig: JanusPluginConfig,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (pluginConfig.lite_workspace_dir !== undefined) return pluginConfig.lite_workspace_dir
  const home = env.HOME !== undefined && env.HOME.length > 0 ? env.HOME : homedir()
  const dataHome =
    env.XDG_DATA_HOME !== undefined && env.XDG_DATA_HOME.length > 0
      ? env.XDG_DATA_HOME
      : join(home, ".local", "share")
  return join(dataHome, "janus-agent", "lite")
}

/**
 * lite's permissions: read tools allowed, its own workspace writable
 * without asking, everything else asks, and dispatch denied (leaf node).
 * Pattern objects put the `"*"` catch-all first (last matching rule wins).
 */
export function buildLitePermission(workspaceDir: string): Record<string, unknown> {
  return {
    webfetch: "allow",
    websearch: "allow",
    edit: { "*": "ask", [`${workspaceDir}/**`]: "allow" },
    bash: { "*": "ask", ...READONLY_BASH_RULES },
    external_directory: { [`${workspaceDir}/**`]: "allow" },
    task: "deny",
  }
}

/**
 * Build the runtime bindings block injected into the lite agent prompt.
 * Reports the memory MCP server, lite's model, the escalation targets, the
 * pre-approved workspace, the memory namespace, and the leaf rule.
 */
export function buildLiteRuntimeBindings(
  pluginConfig: JanusPluginConfig,
  workspaceDir: string,
  namespace: string,
): string {
  const memoryLine = pluginConfig.memory_enabled
    ? "- Memory MCP server name: `janus-memory` (tools: memory_recall, memory_expand, memory_prepare, memory_commit, memory_manage)"
    : "- Memory: DISABLED by configuration (saving and recall are unavailable)"

  const modelLine = `- Lite model: \`${resolveRoleModel(pluginConfig, "lite")}\``

  const consultantLine = `- Consultant: \`consultant\` (\`${resolveRoleModel(pluginConfig, "consultant")}\`) — escalate multi-source evidence, decisions, and documents`
  const coderLine = `- Coder: \`${pluginConfig.coder_agent}\` (\`${resolveRoleModel(pluginConfig, "coder")}\`) — escalate coding and repository work`
  const janusLine = `- Janus: \`${pluginConfig.janus_agent}\` (\`${resolveRoleModel(pluginConfig, "janus")}\`) — escalate general questions that need more context`

  const workspaceLine = `- Your writable workspace: \`${workspaceDir}\` — the only location where creating files is pre-approved; every other write asks first`

  const namespaceLine = `- Memory namespace: \`${namespace}\``

  return `## Runtime Bindings (injected by opencode-adapter)\n${memoryLine}\n${modelLine}\n${consultantLine}\n${coderLine}\n${janusLine}\n- You are a leaf: do not dispatch another agent; escalate instead.\n${workspaceLine}\n${namespaceLine}`
}

/**
 * Register the `lite` agent (mode "all": user-selectable entry, but a leaf
 * that never dispatches). Reads `assets/agents/lite.md`, injects the runtime
 * bindings block, attempts to create the workspace directory (non-fatal), and
 * never clobbers a pre-existing user-defined entry.
 */
export async function registerLite(
  config: MutableConfig,
  pluginConfig: JanusPluginConfig,
  namespace: string,
): Promise<void> {
  const agentName = pluginConfig.lite_agent
  if (config.agent?.[agentName]) return

  const workspaceDir = resolveLiteWorkspaceDir(pluginConfig)
  try {
    mkdirSync(workspaceDir, { recursive: true })
  } catch {
    // Non-fatal: the permission pattern still ships; writes there may fail.
  }

  const body = await readFile(resolveAsset("agents/lite.md"), "utf8")
  const modelBlock = await resolveModelPrompt(pluginConfig, resolveRoleModel(pluginConfig, "lite"))
  const withModelPrompt = injectModelPrompt(body, modelBlock)
  const runtimeBlock = buildLiteRuntimeBindings(pluginConfig, workspaceDir, namespace)
  const assembledPrompt = injectRuntimeBindings(withModelPrompt, runtimeBlock)

  const entry: AllModeAgentEntry = {
    mode: "all",
    description: LITE_DESCRIPTION,
    prompt: assembledPrompt,
    model: resolveRoleModel(pluginConfig, "lite"),
    permission: buildLitePermission(workspaceDir),
  }

  if (!config.agent) config.agent = {}
  config.agent[agentName] = entry
}

/**
 * coder's runtime bindings: its own model, the coding lanes it may dispatch,
 * and the job-tool discipline. No memory namespace (coding sessions use the
 * repo's AGENTS.md, not consultation memory).
 */
export function buildCoderRuntimeBindings(pluginConfig: JanusPluginConfig): string {
  const modelLine = `- Coder model: \`${resolveRoleModel(pluginConfig, "coder")}\``
  const coderLiteLine = pluginConfig.coder_lite_enabled
    ? `- Mechanical lane: \`${pluginConfig.coder_lite_agent}\` (\`${resolveRoleModel(pluginConfig, "coder-lite")}\`) for fully specified mechanical coding and file tasks`
    : "- Mechanical lane: coder-lite DISABLED by configuration"
  const buildLine = pluginConfig.build_enabled
    ? `- Optional stronger-model lane: role \`build\` routes to agent \`${pluginConfig.build_agent}\` (\`${pluginConfig.build_model ?? "host default model"}\`)`
    : "- Optional stronger-model lane: build DISABLED by configuration"
  const dispatchLine =
    "- Job tools: `janus_dispatch` (role, prompt) uses a soft wait; pending/unknown is not failure. Continue the same job with `janus_dispatch_wait` (job_id, wait_ms?; integer 0..300000, default 300000; 0 snapshots). Only `janus_dispatch_cancel` (job_id) requests cancellation; cancelling is not confirmed cancellation."
  return `## Runtime Bindings (injected by opencode-adapter)\n${modelLine}\n${coderLiteLine}\n${buildLine}\n${dispatchLine}`
}

/**
 * Register the `coder` coding entry (mode "all": user-selectable primary and
 * dispatchable subagent). Full host permissions; it is a primary execution
 * seat, not a read-only specialist.
 */
export async function registerCoder(
  config: MutableConfig,
  pluginConfig: JanusPluginConfig,
): Promise<void> {
  if (config.agent?.[pluginConfig.coder_agent]) return

  const body = await readFile(resolveAsset("agents/coder.md"), "utf8")
  const modelBlock = await resolveModelPrompt(pluginConfig, resolveRoleModel(pluginConfig, "coder"))
  const withModelPrompt = injectModelPrompt(body, modelBlock)
  const runtimeBlock = buildCoderRuntimeBindings(pluginConfig)
  const assembledPrompt = injectRuntimeBindings(withModelPrompt, runtimeBlock)

  const entry: AllModeAgentEntry = {
    mode: "all",
    description: CODER_DESCRIPTION,
    prompt: assembledPrompt,
    model: resolveRoleModel(pluginConfig, "coder"),
    permission: {},
  }

  if (!config.agent) config.agent = {}
  config.agent[pluginConfig.coder_agent] = entry
}

/**
 * coder-lite's permissions: workspace edits allowed without asking (the edit
 * resource is location-relative for workspace paths, so "*" matches them and
 * the later "/*" rule only matches external absolute paths), external edits
 * ask, read-only bash allowed, everything else asks, and further subagent
 * dispatch is denied (leaf node).
 */
export function buildCoderLitePermission(): Record<string, unknown> {
  return {
    edit: { "*": "allow", "/*": "ask" },
    bash: { "*": "ask", ...READONLY_BASH_RULES },
    webfetch: "allow",
    websearch: "allow",
    task: "deny",
  }
}

/**
 * Register the `coder-lite` mechanical coding lane: mode "subagent", a static
 * prompt (leaf node — never dispatches, so no runtime bindings block), a
 * step cap of 50 with report-up, and the workspace-allow permission set.
 * A pre-existing user-defined entry under the same name is left untouched.
 */
export async function registerCoderLite(
  config: MutableConfig,
  pluginConfig: JanusPluginConfig,
): Promise<void> {
  const agentName = pluginConfig.coder_lite_agent
  if (config.agent?.[agentName]) return

  const body = await readFile(resolveAsset("agents/coder-lite.md"), "utf8")
  const modelBlock = await resolveModelPrompt(pluginConfig, resolveRoleModel(pluginConfig, "coder-lite"))
  const prompt = injectModelPrompt(body, modelBlock)

  const entry: CodingLaneEntry = {
    mode: "subagent",
    description: CODER_LITE_DESCRIPTION,
    prompt,
    model: resolveRoleModel(pluginConfig, "coder-lite"),
    steps: 50,
    permission: buildCoderLitePermission(),
  }

  if (!config.agent) config.agent = {}
  config.agent[agentName] = entry
}

/**
 * Build the runtime bindings block injected into the janus agent prompt.
 *
 * Janus is the daily-driver primary and does not attach to memory, so its
 * block reports only what it needs to orchestrate: its own model, the
 * entry/specialist targets it routes to (consultant, coder, lite, explorer),
 * and the dispatch job-tool discipline. No memory namespace, no workspace.
 */
export function buildJanusRuntimeBindings(pluginConfig: JanusPluginConfig): string {
  const modelLine = `- Janus model: \`${resolveRoleModel(pluginConfig, "janus")}\``

  const consultantLine = `- \`consultant\` (agent \`consultant\`, \`${resolveRoleModel(pluginConfig, "consultant")}\`) — evidence-graded research, decisions, durable documents; dispatch via \`janus_dispatch\` (role="consultant")`
  const coderLine = `- \`coder\` (agent \`${pluginConfig.coder_agent}\`, \`${resolveRoleModel(pluginConfig, "coder")}\`) — coding, debugging, refactoring, tests, repo work; dispatch via \`janus_dispatch\` (role="coder")`
  const liteLine = pluginConfig.lite_enabled
    ? `- \`lite\` (agent \`${pluginConfig.lite_agent}\`, \`${resolveRoleModel(pluginConfig, "lite")}\`) — quick facts, concepts, simple how-to`
    : "- Economical entry: lite DISABLED by configuration"
  const explorerLine = `- \`explorer\` (agent \`${pluginConfig.explorer_agent}\`, \`${resolveRoleModel(pluginConfig, "explorer")}\`) — bulk retrieval only`

  const dispatchLine = "- Job tools: `janus_dispatch` (role, prompt) uses a soft wait; pending/unknown is not failure. Continue the same job with `janus_dispatch_wait` (job_id, wait_ms?; integer 0..300000, default 300000; 0 snapshots). Only `janus_dispatch_cancel` (job_id) requests cancellation; cancelling is not confirmed cancellation."

  return `## Runtime Bindings (injected by opencode-adapter)\n${modelLine}\n${consultantLine}\n${coderLine}\n${liteLine}\n${explorerLine}\n${dispatchLine}`
}

/**
 * Register the `janus` daily-driver primary agent: mode "all" (user-selectable
 * primary AND dispatchable), no memory attachment, a layered prompt (role
 * asset + model-adaptation block + runtime bindings), and the resolved janus
 * model. A pre-existing user-defined entry under the same name is left
 * untouched.
 */
export async function registerJanus(
  config: MutableConfig,
  pluginConfig: JanusPluginConfig,
): Promise<void> {
  if (config.agent?.[pluginConfig.janus_agent]) return

  const body = await readFile(resolveAsset("agents/janus.md"), "utf8")
  const modelBlock = await resolveModelPrompt(pluginConfig, resolveRoleModel(pluginConfig, "janus"))
  const withModelPrompt = injectModelPrompt(body, modelBlock)
  const runtimeBlock = buildJanusRuntimeBindings(pluginConfig)
  const assembledPrompt = injectRuntimeBindings(withModelPrompt, runtimeBlock)

  const entry: AllModeAgentEntry = {
    mode: "all",
    description: JANUS_DESCRIPTION,
    prompt: assembledPrompt,
    model: resolveRoleModel(pluginConfig, "janus"),
    permission: {},
  }

  if (!config.agent) config.agent = {}
  config.agent[pluginConfig.janus_agent] = entry
}

/**
 * Build the runtime bindings block that the adapter injects into the
 * consultant agent prompt.
 *
 * Reports: the memory MCP server (or DISABLED), the consultant model, the
 * team subagents with their models, and the memory namespace.
 */
export function buildRuntimeBindings(
  pluginConfig: JanusPluginConfig,
  namespace: string,
): string {
  const memoryLine = pluginConfig.memory_enabled
    ? "- Memory MCP server name: `janus-memory` (tools: memory_recall, memory_expand, memory_prepare, memory_commit, memory_manage)"
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
  roleParts.push(
    pluginConfig.writer_delegate_agent !== undefined
      ? `writer delegated to \`${pluginConfig.writer_delegate_agent}\``
      : pluginConfig.writer_enabled
        ? `writer \`${pluginConfig.writer_agent}\` (${resolveRoleModel(pluginConfig, "writer")})`
        : "writer DISABLED by configuration",
  )
  const teamLine = `- Team subagents: ${roleParts.join(", ")}`

  const liteLine = pluginConfig.lite_enabled
    ? `- Economical leaf: \`${pluginConfig.lite_agent}\` (\`${resolveRoleModel(pluginConfig, "lite")}\`) for bounded quick-answer tasks`
    : "- Economical leaf: lite DISABLED by configuration"
  const coderLine = pluginConfig.coder_enabled
    ? `- Coding delegate: \`${pluginConfig.coder_agent}\` (\`${resolveRoleModel(pluginConfig, "coder")}\`) for code examples and bounded code tasks; it owns the coding lanes`
    : "- Coding delegate: coder DISABLED by configuration"

  const caps = resolveTeamCaps(pluginConfig)
  const tiers = resolveTierRoleCaps(pluginConfig)
  const costGuard = resolveCostGuardUsd(pluginConfig)

  const capsLine = `- Team maximums (not targets): round_cap=${caps.round_cap}, explorer<=${caps.explorer_cap}, critic_searches<=${caps.critic_search_cap} per round`
  const tierMatrixLine = `- Tier role maximums (not a required roster): fast(e${tiers.fast.explorer},a${tiers.fast.analyst},c${tiers.fast.critic},v${tiers.fast.verifier},w${tiers.fast.writer}) standard(e${tiers.standard.explorer},a${tiers.standard.analyst},c${tiers.standard.critic},v${tiers.standard.verifier},w${tiers.standard.writer}) deep(e${tiers.deep.explorer},a${tiers.deep.analyst},c${tiers.deep.critic},v${tiers.deep.verifier},w${tiers.deep.writer})`
  const costLine = `- Cost guard: ~$${costGuard} per provider (advisory, converge when approaching)`

  const namespaceLine = `- Memory namespace: \`${namespace}\``
  const dispatchLine = "- Job tools: `janus_dispatch` (role, prompt) uses a soft wait; pending/unknown is not failure. Continue the same job with `janus_dispatch_wait` (job_id, wait_ms?; integer 0..300000, default 300000; 0 snapshots). Only `janus_dispatch_cancel` (job_id) requests cancellation; cancelling is not confirmed cancellation."

  return `## Runtime Bindings (injected by opencode-adapter)\n${memoryLine}\n${consultantModelLine}\n${teamLine}\n${liteLine}\n${coderLine}\n${dispatchLine}\n${capsLine}\n${tierMatrixLine}\n${costLine}\n${namespaceLine}`
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
 * Normalize a model id ("provider/model") into a provider-agnostic match key.
 *
 * The key strips the provider prefix (everything up to and including the last
 * "/"), lowercases the remainder, and keeps only ASCII letters and digits —
 * so `deepseek/deepseek-v4-pro` and `opencode-go/deepseek-v4-pro` both resolve
 * to `deepseekv4pro`, and the same model-prompt block drives either provider.
 * The shipped library files (`assets/model-prompts/<key>.md`) and the
 * `model_prompts` config keys use this exact normalized form.
 */
export function normalizeModelKey(modelId: string): string {
  return modelId
    .slice(modelId.lastIndexOf("/") + 1)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
}

/**
 * Resolve the model-adaptation block for a model, keyed by the model itself
 * and decoupled from both the agent and the provider: the user's global
 * `model_prompts` map wins (keyed by the normalized model key; an explicit ""
 * disables that model's block), else the shipped
 * `assets/model-prompts/<key>.md` block if a file for the model exists, else
 * empty.
 */
export async function resolveModelPrompt(
  pluginConfig: JanusPluginConfig,
  resolvedModel: string,
): Promise<string> {
  const key = normalizeModelKey(resolvedModel)
  const override = pluginConfig.model_prompts?.[key]
  if (override !== undefined) return override
  try {
    return await readFile(resolveAsset(`model-prompts/${key}.md`), "utf8")
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
  pluginConfig: JanusPluginConfig,
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
    pluginConfig: JanusPluginConfig
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
    permission: { edit: "deny", bash: "deny", task: "deny" },
  }

  if (!config.agent) config.agent = {}
  config.agent[options.name] = entry
}

export async function registerExplorer(
  config: MutableConfig,
  pluginConfig: JanusPluginConfig,
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
  pluginConfig: JanusPluginConfig,
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
  pluginConfig: JanusPluginConfig,
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
  pluginConfig: JanusPluginConfig,
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
  pluginConfig: JanusPluginConfig,
): Promise<void> {
  if (pluginConfig.writer_delegate_agent !== undefined) return
  await registerReadOnlySubagent(config, {
    name: pluginConfig.writer_agent,
    description: WRITER_DESCRIPTION,
    assetFile: "agents/writer.md",
    model: resolveRoleModel(pluginConfig, "writer"),
    pluginConfig,
  })
}
