import { tool, type ToolContext, type ToolDefinition, type PluginInput } from "@opencode-ai/plugin"
import {
  loadPluginConfig,
  resolveRoleModel,
  resolveRoleModelChain,
  type JanusPluginConfig,
} from "./plugin-config.ts"
import {
  DISPATCH_ROLES,
  createKeyedMutex,
  parseWaitArgs,
  type Clock,
  type DispatchRole,
  type DispatchSdk,
  type KeyedMutex,
} from "./dispatch-contract.ts"
import { createDispatchLifecycle, createSystemClock, type DispatchLifecycle } from "./dispatch-lifecycle.ts"
import { createDispatchCancel } from "./dispatch-cancel.ts"
import { splitModel, errorText, isRetryableModelError } from "./dispatch-helpers.ts"

export { splitModel, errorText, isRetryableModelError }

/**
 * The ten dispatch roles: the five research specialists, the two entry
 * delegates (consultant, coder), the economical leaf (lite), the mechanical
 * lane (coder-lite), and the optional host build target.
 */
export { DISPATCH_ROLES }
export type { DispatchRole }

export interface RoleTarget {
  agentName: string
  model?: string
}

export function resolveRoleTarget(
  config: JanusPluginConfig,
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
    case "coder":
      return { agentName: config.coder_agent, model: resolveRoleModel(config, "coder") }
    case "lite":
      return { agentName: config.lite_agent, model: resolveRoleModel(config, "lite") }
    case "coder-lite":
      return { agentName: config.coder_lite_agent, model: resolveRoleModel(config, "coder-lite") }
    case "build":
      return { agentName: config.build_agent, model: config.build_model }
    case "consultant":
      return { agentName: "consultant", model: resolveRoleModel(config, "consultant") }
  }
}

export interface DispatchToolDeps {
  readonly clock?: Clock
  readonly mutex?: KeyedMutex
  readonly lifecycle?: DispatchLifecycle
}

/**
 * Build the three consultation job tools with one shared coordinator set.
 *
 * It dispatches ONLY to the consultation roles (`consultant`, `coder`, `lite`,
 * `explorer`, `analyst`, `critic`, `verifier`, `writer`, `coder-lite`, `build`)
 * using the recoverable lifecycle coordinator. It is additive: it neither
 * shadows nor interferes with the built-in `task` tool or any other plugin's
 * tools.
 */
export function createJanusDispatchTools(
  client: PluginInput["client"],
  deps: DispatchToolDeps = {},
) {
  const sdk = client as unknown as DispatchSdk
  const clock = deps.clock ?? createSystemClock()
  const mutex = deps.mutex ?? createKeyedMutex()
  const lifecycle =
    deps.lifecycle ??
    createDispatchLifecycle({ sdk, clock, mutex })
  const cancelHandler = createDispatchCancel({ sdk, clock, mutex })

  const dispatch = tool({
    description:
      "Dispatch ONLY to a consultation role (consultant, coder, lite, explorer, analyst, critic, verifier, writer, coder-lite, build). Returns its result or a recoverable job id if still working after a soft wait; call janus_dispatch_wait with that job id to continue waiting.",
    args: {
      role: tool.schema.enum(DISPATCH_ROLES),
      prompt: tool.schema.string(),
    },
    async execute(args, context: ToolContext): Promise<string> {
      const config = await loadPluginConfig(process.env)
      const enabled: Record<DispatchRole, boolean> = {
        explorer: true,
        analyst: true,
        critic: config.critic_enabled,
        verifier: config.verifier_enabled,
        writer: config.writer_enabled || config.writer_delegate_agent !== undefined,
        coder: config.coder_enabled,
        lite: config.lite_enabled,
        "coder-lite": config.coder_lite_enabled,
        build: config.build_enabled,
        consultant: true,
      }
      if (!enabled[args.role]) return `Error: ${args.role} is disabled by configuration`

      const { agentName, model } = resolveRoleTarget(config, args.role)
      const modelChain: Array<string | null> =
        args.role === "build" || (args.role === "writer" && config.writer_delegate_agent !== undefined)
          ? [model ?? null]
          : resolveRoleModelChain(config, args.role).map((m) => m ?? null)

      return lifecycle.launch({
        role: args.role,
        prompt: args.prompt,
        agentName,
        modelChain,
        parentID: context.sessionID,
        directory: context.directory,
        signal: context.abort,
      })
    },
  })

  const wait = tool({
    description:
      "Retrieve a consultation job's result or detect completion, waiting up to wait_ms (default 300000, max 300000; 0 takes one snapshot). Soft expiry preserves the job and returns a recoverable job id, not a specialist failure.",
    args: {
      job_id: tool.schema.string(),
      wait_ms: tool.schema.number().optional(),
    },
    async execute(args, context: ToolContext): Promise<string> {
      const parsed = parseWaitArgs(args)
      if (!parsed.ok) return `Error: ${parsed.error.message}`
      return lifecycle.wait({
        jobID: parsed.value.job_id,
        waitMs: parsed.value.wait_ms,
        parentID: context.sessionID,
        directory: context.directory,
        signal: context.abort,
      })
    },
  })

  const cancel = tool({
    description:
      "Request cancellation of a pending consultation job. May return a cancelling status if cancellation is not yet confirmed; use janus_dispatch_wait to reconcile. Already completed results are preserved.",
    args: { job_id: tool.schema.string() },
    async execute(args, context: ToolContext): Promise<string> {
      return cancelHandler.cancel({
        jobID: args.job_id,
        parentID: context.sessionID,
        directory: context.directory,
        signal: context.abort,
      })
    },
  })

  return {
    janus_dispatch: dispatch,
    janus_dispatch_wait: wait,
    janus_dispatch_cancel: cancel,
  }
}

export function createJanusDispatchTool(
  client: PluginInput["client"],
  deps: DispatchToolDeps = {},
): ToolDefinition {
  return createJanusDispatchTools(client, deps).janus_dispatch
}
