import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setImmediate } from "node:timers/promises"
import type { ToolDefinition } from "@opencode-ai/plugin"
import * as dispatchTools from "./dispatch-tool.ts"
import { ConsultationAgentPlugin } from "./plugin.ts"
import { buildRuntimeBindings } from "./agent-registration.ts"
import { ConsultationPluginConfigSchema } from "./plugin-config.ts"
import { createFakeClock } from "./dispatch-test-fixtures.ts"
import { context, envelope, fixture, pluginInput } from "./dispatch-registration-fixtures.ts"

const { createConsultationDispatchTools } = dispatchTools

describe("unified dispatch registration", () => {
  let directory: string
  let previousConfig: string | undefined
  beforeEach(() => {
    previousConfig = process.env.CONSULTATION_CONFIG
    directory = mkdtempSync(join(tmpdir(), "dispatch-registration-"))
    process.env.CONSULTATION_CONFIG = join(directory, "config.jsonc")
    writeFileSync(join(directory, "config.jsonc"), "{}")
  })
  afterEach(() => {
    if (previousConfig === undefined) delete process.env.CONSULTATION_CONFIG
    else process.env.CONSULTATION_CONFIG = previousConfig
    rmSync(directory, { recursive: true, force: true })
  })

  it("recovers a soft-expired dispatch through the shared wait tool", async () => {
    // Given a real coordinator set with an injected clock and active work.
    const f = fixture()
    const clock = createFakeClock()
    f.sdk.setStatusResult({ data: { ses_fake_1: { type: "busy" } } })
    const tools = createConsultationDispatchTools(pluginInput(f.sdk).client, { clock })
    const launched = tools.consultation_dispatch.execute({ role: "analyst", prompt: "analyze" }, context())
    await setImmediate()
    for (let i = 0; i < 300; i++) {
      await setImmediate()
      clock.advance(2_000)
    }
    const job = envelope(await launched)
    expect(job.status).toBe("pending")
    expect(f.aborts).toEqual([])
    f.finish()
    // When a later wait observes the same durable job.
    const result = await tools.consultation_dispatch_wait.execute({ job_id: job.job_id, wait_ms: 0 }, context())
    // Then no replacement generation occurs.
    expect(result).toBe("final report")
    expect(f.submissions).toHaveLength(1)
  })

  for (const action of ["wait", "cancel"] as const) {
    it(`uses the plugin hook's ${action} tool on its dispatched job`, async () => {
      // Given an interrupted observation, not an interrupted specialist.
      const f = fixture()
      const controller = new AbortController()
      const submit = f.sdk.session.promptAsync
      f.sdk.session.promptAsync = async (input) => {
        const result = await submit(input)
        controller.abort()
        return result
      }
      const hooks = await ConsultationAgentPlugin(pluginInput(f.sdk))
      const tools = hooks.tool
      if (!tools) throw new Error("missing plugin tools")
      const dispatch = tools["consultation_dispatch"]
      const control = tools[`consultation_dispatch_${action}`]
      if (!dispatch || !control) throw new Error("missing job control tool")
      const job = envelope(await dispatch.execute({ role: "explorer", prompt: "search" }, context(controller.signal)))
      if (action === "wait") f.finish()
      else {
        const abort = f.sdk.session.abort
        f.sdk.session.abort = async (input) => {
          const result = await abort(input)
          f.finish("", true)
          return result
        }
      }
      // When controlling the job through the very same hook object.
      const result = await control.execute({ job_id: job.job_id, wait_ms: 0 }, context())
      // Then ownership and generation identity remain intact.
      if (action === "wait") expect(result).toBe("final report")
      else expect(envelope(result).status).toBe("cancelled")
      expect(f.submissions).toHaveLength(1)
      expect(f.aborts).toEqual(action === "cancel" ? [job.session_id] : [])
    })
  }

  for (const wait_ms of [-1, 300_001, 1.5]) {
    it(`rejects wait_ms=${wait_ms} before any SDK access`, async () => {
      // Given untrusted out-of-contract wait arguments.
      const f = fixture()
      const tools = createConsultationDispatchTools(pluginInput(f.sdk).client)
      // When invoking wait directly (without framework schema validation).
      const result = await tools.consultation_dispatch_wait.execute({ job_id: "ses_missing", wait_ms }, context())
      // Then the typed boundary reports an error, never clamps or reads.
      expect(result).toMatch(/^Error:/)
      expect(f.sdk.calls).toEqual([])
    })
  }

  it("ignores routing and ownership overrides in cancellation args", async () => {
    // Given a job belonging to another parent and malicious extra fields.
    const f = fixture()
    f.sdk.setPromptAsyncRejection(new Error("lost acknowledgement"))
    const tools = createConsultationDispatchTools(pluginInput(f.sdk).client)
    const job = envelope(await tools.consultation_dispatch.execute({ role: "writer", prompt: "draft" }, context()))
    expect(Object.keys(tools.consultation_dispatch_cancel.args)).toEqual(["job_id"])
    expect(Object.keys(tools.consultation_dispatch_wait.args)).toEqual(["job_id", "wait_ms"])
    // When the attacker supplies the actual owner in args instead of context.
    const maliciousArgs = {
      job_id: job.job_id, parentID: "ses_parent", role: "analyst", agent: "evil", model: "evil/model", wait_ms: 0,
    }
    const result = await tools.consultation_dispatch_cancel.execute(maliciousArgs, { ...context(), sessionID: "ses_attacker" })
    // Then the context binding prevails and nothing is aborted/generated.
    expect(result).toMatch(/^Error:/)
    expect(f.aborts).toEqual([])
    expect(f.submissions).toHaveLength(1)
  })

  it("serializes concurrent wait and cancel on one job", async () => {
    // Given a launched job and a wait holding the job lock during a deferred read.
    const f = fixture()
    f.sdk.setPromptAsyncRejection(new Error("lost acknowledgement"))
    const tools = createConsultationDispatchTools(pluginInput(f.sdk).client)
    const job = envelope(await tools.consultation_dispatch.execute({ role: "analyst", prompt: "analyze" }, context()))
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const read = f.sdk.session.messages
    f.sdk.session.messages = async (input) => {
      if (input.path.id === job.session_id) {
        entered.resolve()
        await release.promise
      }
      return read(input)
    }
    const waiting = tools.consultation_dispatch_wait.execute({ job_id: job.job_id, wait_ms: 0 }, context())
    await entered.promise
    // When cancel queues behind the observation, and the specialist finishes.
    const readsBeforeCancel = f.sdk.calls.length
    const cancelling = tools.consultation_dispatch_cancel.execute({ job_id: job.job_id }, context())
    await setImmediate()
    expect(f.sdk.calls).toHaveLength(readsBeforeCancel)
    f.finish()
    release.resolve()
    // Then both see completion; cancel never writes intent or aborts in parallel.
    expect(await Promise.all([waiting, cancelling])).toEqual(["final report", "final report"])
    expect(f.aborts).toEqual([])
    expect(f.submissions).toHaveLength(1)
  })

  it("names all job-control tools in assembled runtime bindings", () => {
    // Given default role configuration.
    const config = ConsultationPluginConfigSchema.parse({})
    // When building runtime bindings consumed by the consultant.
    const bindings = buildRuntimeBindings(config, "oc-test")
    // Then routing-bearing structural tool names are available (no prose pin).
    expect(bindings.match(/`consultation_dispatch(?:_wait|_cancel)?`/g)).toEqual([
      "`consultation_dispatch`", "`consultation_dispatch_wait`", "`consultation_dispatch_cancel`",
    ])
  })

  for (const scenario of [
    { role: "explorer", agent: "consultation-explorer", model: "opencode-go/deepseek-v4.1-flash" },
    { role: "analyst", agent: "consultation-analyst", model: "opencode-go/qwen3.8-max" },
    { role: "critic", agent: "consultation-critic", model: "opencode-go/glm-5.3" },
    { role: "verifier", agent: "consultation-verifier", model: "opencode-go/glm-5.3" },
    { role: "writer", agent: "consultation-writer", model: "opencode/claude-sonnet-5" },
    { role: "simple", agent: "simple", model: "opencode-go/deepseek-v4.1-flash" },
  ] as const) {
    for (const custom of [false, true]) {
      it(`routes ${scenario.role} through the shared factory with ${custom ? "custom" : "default"} configuration`, async () => {
        // Given distinct default/override routes and a completed specialist.
        const agent = custom ? `custom-${scenario.role}` : scenario.agent
        const model = custom ? `custom/${scenario.role}` : scenario.model
        if (custom) writeFileSync(join(directory, "config.jsonc"), JSON.stringify({
          [`${scenario.role}_agent`]: agent, [`${scenario.role}_model`]: model,
        }))
        const f = fixture()
        const submit = f.sdk.session.promptAsync
        f.sdk.session.promptAsync = async (input) => {
          const result = await submit(input)
          f.finish()
          return result
        }
        const tools = createConsultationDispatchTools(pluginInput(f.sdk).client)
        // When dispatching the configured role.
        const result = await tools.consultation_dispatch.execute({ role: scenario.role, prompt: "bounded task" }, context())
        // Then the actual generating request uses the selected route.
        expect(result).toBe("final report")
        expect(f.submissions.map((s) => ({ agent: s.body.agent, model: s.body.model }))).toEqual([{
          agent, model: { providerID: model.split("/")[0] ?? "", modelID: model.split("/")[1] ?? "" },
        }])
      })
    }
  }

  it("rejects an invalid role without SDK access", async () => {
    // Given an unsupported role arriving at the execution boundary.
    const f = fixture()
    const tools = createConsultationDispatchTools(pluginInput(f.sdk).client)
    // When dispatching an invalid role.
    const dispatch: ToolDefinition = tools.consultation_dispatch
    const result = await dispatch.execute({ role: "general", prompt: "task" }, context())
    // Then no child or generating request is created.
    expect(result).toMatch(/^Error:/)
    expect(f.sdk.calls).toEqual([])
  })

  for (const pinned of [false, true]) {
    it(`retains the disabled-bundled writer delegate override with ${pinned ? "a pinned model" : "host model selection"}`, async () => {
      // Given a delegate whose configuration differs from the bundled fallback.
      writeFileSync(join(directory, "config.jsonc"), JSON.stringify({
        writer_enabled: false, writer_delegate_agent: "host-writer",
        ...(pinned ? { writer_delegate_model: "delegate/pinned" } : {}),
      }))
      const f = fixture()
      const submit = f.sdk.session.promptAsync
      f.sdk.session.promptAsync = async (input) => {
        const result = await submit(input)
        f.finish()
        return result
      }
      const tools = createConsultationDispatchTools(pluginInput(f.sdk).client)
      // When dispatching the delegated writer despite the bundled disable flag.
      const result = await tools.consultation_dispatch.execute({ role: "writer", prompt: "draft" }, context())
      // Then host routing, optional model pinning and single-attempt semantics survive.
      expect(result).toBe("final report")
      expect(f.submissions.map((s) => ({ agent: s.body.agent, model: s.body.model }))).toEqual([{
        agent: "host-writer", model: pinned ? { providerID: "delegate", modelID: "pinned" } : undefined,
      }])
    })
  }
})
