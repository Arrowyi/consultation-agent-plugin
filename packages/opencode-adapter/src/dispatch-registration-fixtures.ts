import type { PluginInput, ToolContext } from "@opencode-ai/plugin"
import { parseOutcomeEnvelope, type SdkPromptBody } from "./dispatch-contract.ts"
import { createFakeSdk } from "./dispatch-test-fixtures.ts"

export function context(abort = new AbortController().signal): ToolContext {
  return {
    sessionID: "ses_parent", messageID: "msg_parent", agent: "consultant",
    directory: "/tmp/project", worktree: "/tmp/project", abort,
    metadata: () => {}, ask: async () => {},
  }
}

export function fixture() {
  const sdk = createFakeSdk()
  const submissions: { sessionID: string; body: SdkPromptBody }[] = []
  const aborts: string[] = []
  const submit = sdk.session.promptAsync
  sdk.session.promptAsync = async (input) => {
    submissions.push({ sessionID: input.path.id, body: input.body })
    return submit(input)
  }
  const abort = sdk.session.abort
  sdk.session.abort = async (input) => {
    aborts.push(input.path.id)
    return abort(input)
  }
  function finish(text = "final report", cancelled = false): void {
    const active = submissions.at(-1)
    if (!active?.body.messageID) throw new Error("fixture requires a submitted request")
    sdk.seedMessages(active.sessionID, [{
      info: {
        id: `msg-final-${submissions.length}`, sessionID: active.sessionID,
        role: "assistant", parentID: active.body.messageID,
        time: { created: 1, completed: 1 }, modelID: "m", providerID: "p",
        finish: "stop",
        ...(cancelled ? { error: { name: "MessageAbortedError", data: { message: "cancelled" } } } : {}),
      },
      parts: [{ type: "text", text }],
    }])
  }
  return { sdk, submissions, aborts, finish }
}

export function pluginInput(sdk: ReturnType<typeof createFakeSdk>): PluginInput {
  return {
    client: sdk as unknown as PluginInput["client"],
    project: { id: "registry", worktree: "/tmp/project", time: { created: 0 } },
    directory: "/tmp/project", worktree: "/tmp/project",
    experimental_workspace: { register: () => {} },
    serverUrl: new URL("http://unused.invalid"),
    $: Bun.$,
  }
}

export function envelope(result: string | { readonly output: string }) {
  const parsed = parseOutcomeEnvelope(typeof result === "string" ? result : result.output)
  if (!parsed.ok) throw parsed.error
  return parsed.value
}
