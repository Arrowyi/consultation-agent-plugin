#!/usr/bin/env bun
import { startRuntimeProvider } from "./integration-runtime-provider.ts"
import { createRuntimeHost } from "./integration-runtime-host.ts"
import { EnvelopeSchema, findJob, invokeTool, redactMessages } from "./integration-runtime-driver.ts"
import { gitStatusPorcelain, isOpencodeOnPath, type Assertion } from "./integration-helpers.ts"
import { proveDispatchPrimitives } from "./integration-dispatch-primitives.ts"

async function main() {
  if (!await isOpencodeOnPath()) { console.log("SKIP: opencode absent from PATH"); return }
  const provider = startRuntimeProvider()
  const host = await createRuntimeHost(provider.url)
  const before = await gitStatusPorcelain()
  const assertions: Assertion[] = []
  const trace: unknown[] = []
  const EXPECTED_ASSERTIONS = [
    "official-schema config accepted by installed host",
    "explorer survives actual production 300000ms launch wait",
    "installed wait recovers explorer without inline replacement",
    "cancel/result race preserves completed report",
    ...["analyst", "critic", "verifier", "writer"].flatMap((role) => [
      `${role} installed role routes end-to-end`,
      `${role} real host completed-stop shape`,
    ]),
    "intermediate tool-calls not credited as final",
    "confirmed retryable writer failure advances chain exactly once",
    "completed result survives plugin/server restart",
    "invalid ownership rejected",
    "explicit cancellation uses real abort and reconciles",
    "interrupted running work after hard restart stays nonterminal without duplicate generation",
    "writer delegate routes via host configured model",
    "pinned writer delegate routes via configured model",
    "repo directory untouched during run",
  ]
  function check(name: string, pass: boolean, detail: string) {
    assertions.push({ name, pass, detail })
    console.log(`${pass ? "PASS" : "FAIL"}: ${name} - ${detail}`)
  }
  try {
    await host.start()
    check("official-schema config accepted by installed host", true, "GET /config 200; only fixture provider enabled")
    for (const a of await proveDispatchPrimitives(host.api, host.project)) check(a.name, a.pass, a.detail)
    provider.arm("explorer", [{ kind: "held", gate: "explorer-late", text: "EXPLORER_FINAL" }])
    const parent = await host.createParent()
    const started = Date.now()
    const pendingResult = await invokeTool(host, parent, "consultation_dispatch", { role: "explorer", prompt: "delayed explorer fixture" })
    const launched = await findJob(host, parent)
    const reachedProvider = await Promise.race([provider.requested("explorer").then(() => true), Bun.sleep(15000).then(() => false)])
    if (!reachedProvider) {
      trace.push({ scenario: "CRITICAL-specialist-request-missing", root: launched.root, root_messages: redactMessages(await host.messages(launched.root.id)), attempts: await Promise.all(launched.attempts.map(async (attempt) => ({ session: attempt, messages: redactMessages(await host.messages(attempt.id)) }))) })
      throw new Error("CRITICAL: installed prompt_async produced no specialist provider request; host logs: No user message found in stream. Full lifecycle blocked.")
    }
    const pending = EnvelopeSchema.parse(JSON.parse(await pendingResult()))
    check("explorer survives actual production 300000ms launch wait", pending.status === "pending" && Date.now() - started >= 300000, `status=${pending.status}; elapsed_ms=${Date.now() - started}`)
    const job = await findJob(host, parent)
    trace.push({ scenario: "explorer-pending", root: job.root, attempts: job.attempts, messages: redactMessages(await host.messages(pending.session_id)), status: pending.status, elapsed_ms: Date.now() - started })
    await provider.release("explorer-late")
    const recovered = await (await invokeTool(host, parent, "consultation_dispatch_wait", { job_id: pending.job_id, wait_ms: 10000 }))()
    check("installed wait recovers explorer without inline replacement", recovered.includes("EXPLORER_FINAL") && provider.counts.get("explorer") === 1, `generating_requests=${provider.counts.get("explorer")}`)
    trace.push({ scenario: "explorer-completed", messages: redactMessages(await host.messages(pending.session_id)) })
    const completedCancel = await (await invokeTool(host, parent, "consultation_dispatch_cancel", { job_id: pending.job_id }))()
    check("cancel/result race preserves completed report", completedCancel.includes("EXPLORER_FINAL"), "cancel_resume: completed result wins")
    for (const role of ["analyst", "critic", "verifier", "writer"] as const) {
      provider.arm(role, role === "analyst" ? [{ kind: "tool", name: "read", args: { filePath: `${host.project}/fixture.txt` } }, { kind: "text", text: `${role.toUpperCase()}_FINAL` }] : [{ kind: "text", text: `${role.toUpperCase()}_FINAL` }])
      const roleParent = await host.createParent()
      const output = await (await invokeTool(host, roleParent, "consultation_dispatch", { role, prompt: `${role} fixture` }))()
      check(`${role} installed role routes end-to-end`, output.includes(`${role.toUpperCase()}_FINAL`), `requests=${provider.counts.get(role)}`)
      const roleJob = await findJob(host, roleParent)
      for (const attempt of roleJob.attempts) {
        const messages = await host.messages(attempt.id)
        trace.push({ scenario: role, root: roleJob.root, attempt, messages: redactMessages(messages) })
        const finals = messages.filter((m) => m.info.role === "assistant" && m.info.finish === "stop" && m.info.time.completed !== undefined)
        check(`${role} real host completed-stop shape`, finals.length > 0, `final_messages=${finals.length}`)
        if (role === "analyst") check("intermediate tool-calls not credited as final", messages.some((m) => m.info.finish === "tool-calls" && m.info.time.completed !== undefined) && output.includes("ANALYST_FINAL"), "misleading_success_output")
      }
    }
    // Real host marks 402 nonretryable; 429 supplies authoritative isRetryable:true.
    provider.arm("writer", [{ kind: "error", status: 429 }])
    provider.arm("backup", [{ kind: "text", text: "WRITER_BACKUP_FINAL" }])
    const retryParent = await host.createParent()
    const retryOutput = await (await invokeTool(host, retryParent, "consultation_dispatch", { role: "writer", prompt: "retryable writer fixture" }))()
    const retryJob = await findJob(host, retryParent)
    check("confirmed retryable writer failure advances chain exactly once", retryOutput.includes("WRITER_BACKUP_FINAL") && retryJob.attempts.length === 2 && provider.counts.get("backup") === 1, `attempts=${retryJob.attempts.length}; requests=${provider.counts.get("writer")}`)
    for (const attempt of retryJob.attempts) trace.push({ scenario: "writer-retry", attempt, messages: redactMessages(await host.messages(attempt.id)) })
    await host.restart()
    const countBefore = provider.counts.get("explorer")
    const restartOutput = await (await invokeTool(host, parent, "consultation_dispatch_wait", { job_id: pending.job_id, wait_ms: 0 }))()
    check("completed result survives plugin/server restart", restartOutput.includes("EXPLORER_FINAL") && provider.counts.get("explorer") === countBefore, "stale_state: no duplicate specialist generation")
    const wrongParent = await host.createParent()
    const unavailable = await (await invokeTool(host, wrongParent, "consultation_dispatch_wait", { job_id: pending.job_id, wait_ms: 0 }))()
    check("invalid ownership rejected", unavailable.startsWith("Error:") && provider.counts.get("explorer") === countBefore, "no report or generation returned to wrong parent")
    provider.arm("critic", [{ kind: "held", gate: "cancel-critic", text: "SHOULD_NOT_COMPLETE" }])
    const cancelParent = await host.createParent()
    await invokeTool(host, cancelParent, "consultation_dispatch", { role: "critic", prompt: "cancel fixture" })
    const cancelJob = await findJob(host, cancelParent)
    await host.api(`/session/${cancelParent}/abort`, {})
    const cancellation = await (await invokeTool(host, cancelParent, "consultation_dispatch_cancel", { job_id: cancelJob.root.id }))()
    const cancelled = EnvelopeSchema.parse(JSON.parse(cancellation))
    check("explicit cancellation uses real abort and reconciles", ["cancelled", "cancelling"].includes(cancelled.status), `status=${cancelled.status}`)
    trace.push({ scenario: "cancellation", root: cancelJob.root, attempts: cancelJob.attempts, status: cancelled.status, messages: redactMessages(await host.messages(cancelled.session_id)) })
    provider.arm("verifier", [{ kind: "held", gate: "interrupted-verifier", text: "SHOULD_NOT_RESUME" }])
    const interruptedParent = await host.createParent()
    await invokeTool(host, interruptedParent, "consultation_dispatch", { role: "verifier", prompt: "restart interruption fixture" })
    const interruptedJob = await findJob(host, interruptedParent)
    const interruptedCount = provider.counts.get("verifier")
    await host.restart()
    const interrupted = EnvelopeSchema.parse(JSON.parse(await (await invokeTool(host, interruptedParent, "consultation_dispatch_wait", { job_id: interruptedJob.root.id, wait_ms: 0 }))()))
    // Atlas accepted limitation: hard restart leaves an orphaned assistant without time.completed, conservatively classified pending-active.
    check("interrupted running work after hard restart stays nonterminal without duplicate generation", ["pending", "unknown"].includes(interrupted.status) && provider.counts.get("verifier") === interruptedCount, `repeated_interruptions: validated nonterminal envelope; status=${interrupted.status}; no plain success or Error failure`)
    trace.push({ scenario: "interrupted-restart", root: interruptedJob.root, status: interrupted.status, messages: redactMessages(await host.messages(interrupted.session_id)) })
    await host.restart(true)
    provider.arm("delegate", [{ kind: "text", text: "DELEGATE_FINAL" }])
    const delegateParent = await host.createParent()
    const delegate = await (await invokeTool(host, delegateParent, "consultation_dispatch", { role: "writer", prompt: "delegate fixture" }))()
    check("writer delegate routes via host configured model", delegate.includes("DELEGATE_FINAL") && provider.counts.get("delegate") === 1, "delegate without pinned override")
    provider.arm("delegate", [{ kind: "text", text: "DELEGATE_PINNED_FINAL" }])
    await host.restart(true, "fixture/delegate")
    const pinnedParent = await host.createParent()
    const pinned = await (await invokeTool(host, pinnedParent, "consultation_dispatch", { role: "writer", prompt: "pinned delegate fixture" }))()
    check("pinned writer delegate routes via configured model", pinned.includes("DELEGATE_PINNED_FINAL") && provider.counts.get("delegate") === 2, "delegate with pinned override")
  } catch (error) {
    check("runtime lifecycle execution", false, error instanceof Error ? error.message : String(error))
  } finally {
    try { await host.cleanup() } finally { provider.stop() }
    check("repo directory untouched during run", before === await gitStatusPorcelain(), "git status --porcelain before/after")
    const executed = new Set(assertions.map((a) => a.name))
    const missing = EXPECTED_ASSERTIONS.filter((name) => !executed.has(name))
    check("all expected assertions executed", missing.length === 0, missing.length === 0 ? `inventory=${EXPECTED_ASSERTIONS.length} executed` : `missing=${missing.join(", ")}`)
    console.log(`TRACE_JSON:${JSON.stringify({ entry: host.entry, requests: Object.fromEntries(provider.counts), host_requests: host.calls, scenarios: trace, assertions })}`)
  }
  if (!assertions.length || assertions.some((a) => !a.pass)) process.exitCode = 1
}
await main()
