# consultation-agent-plugin

An evidence-driven consultation agent team for [OpenCode](https://opencode.ai) — a `consultant` that grades evidence and challenges its own conclusions before answering, an economical `simple` for daily questions, a mechanical `build-lite` coding lane, and a shared local memory that learns from every consultation.

## What you get

| Agent | Default model | What it does |
|-------|---------------|--------------|
| `consultant` (primary) | `opencode-go/deepseek-v4-pro` | Evidence-driven consultations in six modes: `select` (choose among candidates), `verify` (verdict on a claim), `plan` (an actionable plan), `guide` (an end-to-end playbook 攻略), `research` (deep topic report), `author` (a durable tutorial / architecture analysis behind one outline approval) |
| `simple` (primary) | `opencode-go/deepseek-v4.1-flash` | Economical daily consultations — fact lookups, concept explanations, simple how-to finding. Escalates complex or high-risk questions to `consultant` instead of guessing |
| `consultation-explorer` | `opencode-go/deepseek-v4.1-flash` | Read-only search specialist returning graded, structured evidence reports |
| `consultation-analyst` | `opencode-go/qwen3.8-max` | Read-only cross-model reasoning over gathered evidence |
| `consultation-critic` | `opencode-go/glm-5.3` | Read-only adversarial reviewer hunting counter-evidence |
| `consultation-verifier` | `opencode-go/glm-5.3` | Read-only source-influence auditor (shilling, smear campaigns, undisclosed sponsorship) |
| `consultation-writer` | `opencode/claude-sonnet-5` | Read-only writing specialist for `author`-mode documents |
| `build-lite` (subagent) | `opencode-go/glm-5.3-flash` | Mechanical coding lane: fully specified bulk edits, formatting/lint fixes, boilerplate from templates. Workspace edits allowed, everything else asks; stops and reports up on anything ambiguous |
| `build` (dispatch role) | host's build agent | Routes judgment-heavy coding to your OpenCode's native build agent — if unavailable, you get a hint and the primary codes inline with disclosure |
| `consultation-memory` (MCP) | — | Local SQLite memory shared across the agents: auto-saved consultation records, recall, edit, delete, outcome feedback |

Every agent's model is configurable (`*_model` fields), and every prompt layers a role asset with an optional per-model adaptation block you can customize per model (`*_model_prompts` maps) — swap a model, keep the role, adapt the driving notes.

## Prerequisites

- [OpenCode](https://opencode.ai) (the agent harness)
- [Bun](https://bun.sh) >= 1.1 (runs the local memory MCP server and the installer)
- The shipped model defaults assume an **OpenCode Go subscription** (`opencode-go/*`, `opencode/claude-sonnet-5`). Without one, set every `*_model` to a provider configured on your machine — see the [non-Go example](docs/deployment.md) in the deployment guide. Dispatch failures print a remediation hint naming the exact config field.

## Install

```bash
git clone https://github.com/Arrowyi/consultation-agent-plugin.git
cd consultation-agent-plugin
bun install

# Build and install the packaged bundle into ~/.local/share/consultation-agent-plugin
bun run install:local
```

Register the printed entry in `~/.config/opencode/opencode.json` (create if missing):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:///home/you/.local/share/consultation-agent-plugin/dist/index.js"]
}
```

Restart OpenCode. The plugin registers the agents, the memory MCP, the `consultation` skill, and the dispatch tools automatically.

## Usage

**Ask the consultant.** It detects the mode, tells you which one it picked and why (e.g. “这是个购买决策 → select”), then delivers:

| Mode | Triggers on | You get |
|------|--------------|---------|
| `select` | choosing among candidates — 买哪个、选课、选工具 | a candidate list with per-candidate evidence grade, contamination note, and trial advice |
| `verify` | checking a claim or rumor — 这说法是不是真的 | a true / false / unverifiable verdict with a per-claim reasoning chain |
| `plan` | an actionable plan — 健身、保养、学习路线 | a step plan with support level, basis, risk, alternatives, and a robustness review |
| `guide` | a composite end-to-end package — 攻略、X入门 | an operational playbook: bottom line, recommendation table, procedure, pitfalls, completion check |
| `research` | understanding a topic deeply — 深度研究、调查一下 | a readable report: bottom line first, plain-language key points, evidence and disagreements folded away |
| `author` | a durable document to keep or share — 教程、架构分析文档、write-up | a tutorial / architecture analysis behind one outline approval, with proportionate verification |

Simple questions get a one-line answer; complex ones get the mode's brief. Facts are separated from inference and labeled with an epistemic status.

**Daily questions go to `simple`.** Select the `simple` agent for lookups and explanations at a fraction of the cost; it escalates to `consultant` (one line, with a reason) when a question needs multi-source adversarial verification or is high-stakes.

**Memory.** Consultations auto-save (question + conclusion summaries — never transcripts). Browse and manage them with the `/consultation-memory` command or the `consultation-memory` CLI. Prior experience and preferences surface in later consultations, with an outcome-feedback loop.

**Configuration.** Optional JSONC config at `~/.config/consultation-agent/config.jsonc` (or `$CONSULTATION_CONFIG` / XDG): per-agent models and model-prompt blocks, agent names, enable flags, team caps, memory and embedding settings. The full field reference lives in [docs/deployment.md](docs/deployment.md).

**Verify your install:**

```bash
CONSULTATION_PLUGIN_ENTRY=~/.local/share/consultation-agent-plugin/dist/index.js bun run integration
```

The isolated integration proof spawns a sandboxed OpenCode server and asserts the agents, MCP, skill, and dispatch tools register correctly — it never touches your real config or data.

## Development

```bash
bun test                     # all unit tests
bun run typecheck            # tsc --noEmit
bun run build                # bundle adapter + memory MCP into dist/
bun run install:local        # build + install the bundle (replaces the installed one)
bun run integration          # isolated OpenCode integration proof
bun run evals/run-evals.ts   # print the evaluation checklist
```

TypeScript strict, zod, SQLite FTS5, five-package Bun workspace, no native dependencies. Harness-neutral core packages (`consultation-core`, `memory-core`); host-specific code stays in the adapters.

**Deployment rule:** always deploy the packaged bundle — never point an OpenCode config at the repo source. The installed bundle is self-contained (no `node_modules` required at runtime).

## Documentation

- [docs/deployment.md](docs/deployment.md) — install, full configuration reference, model prerequisites, uninstall
- [docs/architecture.md](docs/architecture.md) — architecture specification
- [docs/design.md](docs/design.md) — reference design for the agents, their models and permissions
- [evals/README.md](evals/README.md) — evaluation fixtures and grading
