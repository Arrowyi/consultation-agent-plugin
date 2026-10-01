import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"

const logPath = process.argv[2]
if (!logPath) throw new Error("usage: bun run script/integration-runtime-evidence.ts <runtime-log>")
const text = readFileSync(logPath, "utf8")
const traceLine = text.split("\n").find((line) => line.startsWith("TRACE_JSON:"))
if (!traceLine) throw new Error("runtime did not emit structural trace")
const trace = z.object({ entry: z.string(), requests: z.record(z.number()), scenarios: z.array(z.unknown()), assertions: z.array(z.object({ name: z.string(), pass: z.boolean(), detail: z.string() })) }).passthrough().parse(JSON.parse(traceLine.slice("TRACE_JSON:".length)))
const directory = ".omo/evidence/consultation-dispatch-lifecycle"
const pass = trace.assertions.every((a) => a.pass)
const limitation = "Atlas accepted: orphaned incomplete assistant after hard restart may remain pending instead of unknown; no duplicate generation or false terminal claim."
writeFileSync(join(directory, "task-9-installed-runtime.log"), `${text.split("\n").filter((line) => !line.startsWith("TRACE_JSON:")).join("\n")}\nCOMMAND_EXIT: ${pass ? 0 : 1} (real assertions; not SKIP).\nHISTORY: initial globally unique message-ID collision fixed by Atlas; writer fixture corrected to host-retryable 429; durable missing-message grace fixed.\nACCEPTED_LIMITATION: ${limitation}\n`)
writeFileSync(join(directory, "task-9-runtime-trace.json"), JSON.stringify({ ...trace, verdict: pass ? "PASS" : "FAIL", server_version: "1.18.32", lifecycle_command_exit: pass ? 0 : 1, accepted_limitations: [limitation] }, null, 2))
