import { tool, type ToolContext, type ToolDefinition, type PluginInput } from "@opencode-ai/plugin"
import { loadPluginConfig, resolveRoleModel, resolveRoleModelChain, type ConsultationPluginConfig } from "./plugin-config.ts"

/**
 * The five roles the consultant may dispatch. Each maps to one of our own
 * subagents; this tool never touches any other agent, the built-in `task`
 * tool, or any other plugin's dispatch mechanism.
 */
export const DISPATCH_ROLES = ["explorer", "analyst", "critic", "verifier", "writer"] as const
export type DispatchRole = (typeof DISPATCH_ROLES)[number]

export interface RoleTarget {
  agentName: string
  model?: string
}

export function resolveRoleTarget(
  config: ConsultationPluginConfig,
  role: DispatchRole,
): RoleTarget {
  switch (role) {
    case "explorer":
      return { agentName: config.explorer_agent, model: resolveRoleModel(config, "explorer") }
    case "analyst":
      return { agentName: config.analyst_agent, model: resolveRoleModel(config, "analyst") }
    case "critic":
      return { agentName: config.critic_agent, model: resolveRoleModel(config, "critic") }
    case "verifier":
      return { agentName: config.verifier_agent, model: resolveRoleModel(config, "verifier") }
    case "writer":
      if (config.writer_delegate_agent !== undefined) {
        return { agentName: config.writer_delegate_agent, model: config.writer_delegate_model }
      }
      return { agentName: config.writer_agent, model: resolveRoleModel(config, "writer") }
  }
}

/**
 * Split a `provider/model` id into its OpenCode prompt parts.
 * Throws when the id has no `provider/model` separator.
 */
export function splitModel(model: string): { providerID: string; modelID: string } {
  const separator = model.indexOf("/")
  if (separator <= 0 || separator === model.length - 1) {
    throw new Error(`invalid model id "${model}": expected "provider/model"`)
  }
  return { providerID: model.slice(0, separator), modelID: model.slice(separator + 1) }
}

const RETRYABLE_MODEL_ERROR_CODES = ["402", "429", "500", "502", "503", "504"] as const

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null) return JSON.stringify(error)
  return String(error)
}

export function isRetryableModelError(error: unknown): boolean {
  const text = errorText(error)
  return RETRYABLE_MODEL_ERROR_CODES.some((code) => text.includes(code))
}

type TextPart = { type: "text"; text: string }

function extractText(parts: readonly unknown[]): string {
  const texts: string[] = []
  for (const part of parts) {
    if (typeof part !== "object" || part === null) continue
    const record = part as { type?: unknown; text?: unknown }
    if (record.type === "text" && typeof record.text === "string") {
      texts.push(record.text)
    }
  }
  const joined = texts.join("\n").trim()
  return joined.length > 0 ? joined : "(no text in subagent response)"
}

/**
 * The client surface this tool needs. Narrowed structurally so the tool is
 * unit-testable with a fake client; the real `PluginInput["client"]` satisfies
 * it. Only `session.create` + `session.prompt` + `session.abort` are used.
 */
export interface DispatchClient {
  session: {
    create(input: {
      body: { parentID?: string; title?: string }
      query: { directory?: string }
    }): Promise<{ data?: { id: string }; error?: unknown }>
    prompt(input: {
      path: { id: string }
      body: {
        agent?: string
        model?: { providerID: string; modelID: string }
        parts: TextPart[]
      }
    }): Promise<{ data?: { parts?: readonly unknown[] }; error?: unknown }>
    abort(input: { path: { id: string } }): Promise<unknown>
  }
}

/**
 * Build the `consultation_dispatch` tool.
 *
 * It dispatches ONLY to the five consultation subagents (`explorer`,
 * `analyst`, `critic`, `verifier`, `writer`) using the raw OpenCode client
 * session API, pinning both the agent and its configured model. It is additive:
 * it neither shadows nor interferes with the built-in `task` tool or any other
 * plugin's tools.
 *
 * Sync-only in v1: `session.prompt` blocks until the subagent's turn completes
 * and returns the final assistant text. The consultant fans out by issuing
 * multiple calls; true background dispatch is a later enhancement.
 */
export function createConsultationDispatchTool(client: PluginInput["client"]): ToolDefinition {
  const dispatchClient = client as unknown as DispatchClient

  return tool({
    description:
      "Dispatch work to one of the consultation team subagents (explorer, analyst, critic, verifier, writer) and get its result. Dispatch ONLY to these five roles; never use it for any other agent.",
    args: {
      role: tool.schema.enum(DISPATCH_ROLES),
      prompt: tool.schema.string(),
    },
    async execute(args, context: ToolContext): Promise<string> {
      const config = await loadPluginConfig(process.env)
      const { agentName, model } = resolveRoleTarget(config, args.role)
      const attempts: Array<string | undefined> =
        args.role === "writer" && config.writer_delegate_agent !== undefined
          ? [model]
          : resolveRoleModelChain(config, args.role)

      const tried: string[] = []
      let lastError = "unknown error"
      for (const attemptModel of attempts) {
        tried.push(attemptModel ?? `host model of ${agentName}`)
        const createResult = await dispatchClient.session.create({
          body: { parentID: context.sessionID, title: `consultation ${args.role}` },
          query: { directory: context.directory },
        })
        if (createResult.error !== undefined || createResult.data === undefined) {
          return `Error: failed to create subagent session: ${String(createResult.error ?? "unknown error")}`
        }
        const sessionID = createResult.data.id

        try {
          const promptResult = await dispatchClient.session.prompt({
            path: { id: sessionID },
            body: {
              agent: agentName,
              ...(attemptModel === undefined ? {} : { model: splitModel(attemptModel) }),
              parts: [{ type: "text", text: args.prompt }],
            },
          })
          if (promptResult.error !== undefined || promptResult.data === undefined) {
            lastError = errorText(promptResult.error)
            if (isRetryableModelError(promptResult.error)) continue
            return `Error: ${args.role} dispatch failed: ${lastError}`
          }
          return extractText(promptResult.data.parts ?? [])
        } finally {
          // Free the child session after the sync turn completes. Aborting an
          // already-idle session is a no-op; this just prevents lingering
          // subagent sessions from accumulating.
          void dispatchClient.session.abort({ path: { id: sessionID } }).catch(() => {})
        }
      }
      return `Error: ${args.role} dispatch failed on every model in the chain (${tried.join(" -> ")}): ${lastError}; degrade by answering inline and say so.`
    },
  })
}
