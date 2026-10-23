import { tool, type ToolContext, type ToolDefinition, type PluginInput } from "@opencode-ai/plugin"
import { loadPluginConfig, resolveRoleModel, resolveRoleModelChain, type ConsultationPluginConfig } from "./plugin-config.ts"
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
 * The eight dispatchable roles (five specialists, the simple generalist, the
 * build-lite mechanical lane, and the build host-routing role). Each maps to
 * one of our own subagents or the host's configured agent; this tool never
 * touches any other agent, the built-in `task` tool, or any other plugin's
 * dispatch mechanism.
 */
export { DISPATCH_ROLES }
export type { DispatchRole }

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
    case "simple":
      return { agentName: config.simple_agent, model: resolveRoleModel(config, "simple") }
    case "build-lite":
      return { agentName: config.build_lite_agent, model: resolveRoleModel(config, "build-lite") }
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
 * It dispatches ONLY to the consultation team roles (`explorer`, `analyst`,
 * `critic`, `verifier`, `writer`, `simple`, `build-lite`, `build`) using the
 * recoverable lifecycle coordinator. It is additive: it neither shadows nor
 * interferes with the built-in `task` tool or any other plugin's tools.
 */
export function createConsultationDispatchTools(
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
      "Dispatch ONLY to a consultation team role (explorer, analyst, critic, verifier, writer, simple, build-lite, build, consultant). Returns its result or a recoverable job id if still working after a soft wait; call consultation_dispatch_wait with that job id to continue waiting.",
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
        simple: config.simple_enabled,
        "build-lite": config.build_lite_enabled,
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
      "Request cancellation of a pending consultation job. May return a cancelling status if cancellation is not yet confirmed; use consultation_dispatch_wait to reconcile. Already completed results are preserved.",
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
    consultation_dispatch: dispatch,
    consultation_dispatch_wait: wait,
    consultation_dispatch_cancel: cancel,
  }
}

export function createConsultationDispatchTool(
  client: PluginInput["client"],
  deps: DispatchToolDeps = {},
): ToolDefinition {
  return createConsultationDispatchTools(client, deps).consultation_dispatch
}
