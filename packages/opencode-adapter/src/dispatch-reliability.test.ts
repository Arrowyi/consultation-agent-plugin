import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PluginInput, ToolContext } from "@opencode-ai/plugin"
import { createConsultationDispatchTool, type DispatchClient } from "./dispatch-tool.ts"

describe("consultation dispatch reliability", () => {
  let directory: string
  let previousConfig: string | undefined

  beforeEach(() => {
    previousConfig = process.env.CONSULTATION_CONFIG
    directory = mkdtempSync(join(tmpdir(), "consultation-dispatch-reliability-"))
    process.env.CONSULTATION_CONFIG = join(directory, "config.jsonc")
    writeFileSync(process.env.CONSULTATION_CONFIG, "{}")
  })

  afterEach(() => {
    if (previousConfig === undefined) delete process.env.CONSULTATION_CONFIG
    else process.env.CONSULTATION_CONFIG = previousConfig
    rmSync(directory, { recursive: true, force: true })
  })

  const context: ToolContext = {
    sessionID: "ses_parent",
    messageID: "msg_parent",
    agent: "consultant",
    directory: "/tmp/project",
    worktree: "/tmp/project",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  }

  function fakeSession(parts: readonly unknown[]) {
    const calls: string[] = []
    const client: DispatchClient = {
      session: {
        create: async () => {
          calls.push("create")
          return { data: { id: "ses_child" } }
        },
        prompt: async (input) => {
          calls.push(input.body.agent ?? "missing-agent")
          return { data: { parts } }
        },
        abort: async () => {
          calls.push("abort")
          return {}
        },
      },
    }
    const dispatch = createConsultationDispatchTool(client as unknown as PluginInput["client"])
    return { dispatch, calls }
  }

  for (const scenario of [
    { role: "critic", config: { critic_enabled: false } },
    { role: "verifier", config: { verifier_enabled: false } },
    { role: "writer", config: { writer_enabled: false } },
  ] as const) {
    it(`rejects a disabled ${scenario.role} before creating a child session`, async () => {
      writeFileSync(process.env.CONSULTATION_CONFIG ?? "", JSON.stringify(scenario.config))
      const { dispatch, calls } = fakeSession([{ type: "text", text: "should not run" }])

      const result = await dispatch.execute({ role: scenario.role, prompt: "check" }, context)

      expect(result).toBe(`Error: ${scenario.role} is disabled by configuration`)
      expect(calls).toEqual([])
    })
  }

  it("uses an explicitly delegated writer even when the bundled writer is disabled", async () => {
    writeFileSync(process.env.CONSULTATION_CONFIG ?? "", JSON.stringify({
      writer_enabled: false,
      writer_delegate_agent: "host-writer",
    }))
    const { dispatch, calls } = fakeSession([{ type: "text", text: "usable manuscript" }])

    const result = await dispatch.execute({ role: "writer", prompt: "draft" }, context)

    expect(result).toBe("usable manuscript")
    expect(calls).toContain("host-writer")
  })

  for (const scenario of [
    { name: "no parts", parts: [] },
    { name: "blank text", parts: [{ type: "text", text: "   \n " }] },
    { name: "only non-text parts", parts: [{ type: "reasoning", text: "hidden" }] },
  ]) {
    it(`reports ${scenario.name} as missing specialist work`, async () => {
      const { dispatch } = fakeSession(scenario.parts)

      const result = await dispatch.execute({ role: "analyst", prompt: "analyze evidence" }, context)

      expect(result).toBe("Error: analyst dispatch returned no usable text")
    })
  }

  it("preserves usable text from a completed child", async () => {
    const { dispatch } = fakeSession([{ type: "text", text: "finding with source" }])

    const result = await dispatch.execute({ role: "analyst", prompt: "analyze evidence" }, context)

    expect(result).toBe("finding with source")
  })
})
