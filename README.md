# janus-agent-plugin

Janus is a daily-driver agent family for [OpenCode](https://opencode.ai) — `janus` is the default entry, `consultant` owns evidence-graded advice, `coder` owns coding with an adaptive process weight, `lite` is the economical quick-answer leaf, and a shared local memory learns from every consultation.

## What you get

| Agent | Default model | What it does |
|-------|---------------|--------------|
| `janus` (primary/all) | `opencode-go/glm-5.3` | Default daily entry. Handles general questions, light tasks, and routing: consulting → `consultant`, coding → `coder`, quick answers → `lite`. Does not do deep research or heavy coding itself |
| `consultant` (primary) | `opencode-go/glm-5.3` | Evidence-driven consultations in six modes: `select`, `verify`, `plan`, `guide`, `research`, `author`. Leads the five research specialists |
| `coder` (primary/all) | `opencode-go/glm-5.3` | Coding entry and execution specialist. Selects L0/L1/L2/L3 process weight by task complexity, gates design on user approval for L2/L3, and runs the correctness-critical quality gate |
| `lite` (primary/all) | `opencode-go/deepseek-v4.1-flash` | Economical quick-answer leaf: facts, concepts, simple how-to. Never dispatches; escalates complex/contested questions to `consultant`, coding to `coder` |
| `consultation-explorer` | `opencode-go/deepseek-v4.1-flash` | Read-only search specialist returning graded, structured evidence reports |
| `consultation-analyst` | `opencode-go/qwen3.8-max` | Read-only cross-model reasoning over gathered evidence |
| `consultation-critic` | `opencode/gemini-3.8-flash` | Read-only adversarial reviewer hunting counter-evidence |
| `consultation-verifier` | `opencode/gemini-3.8-flash` | Read-only source-influence auditor (shilling, smear campaigns, undisclosed sponsorship) |
| `consultation-writer` | `opencode/claude-sonnet-5-5` | Read-only writing specialist for `author`-mode documents |
| `coder-lite` (subagent) | `opencode-go/glm-5.3-flash` | Mechanical coding lane: fully specified bulk edits, formatting/lint fixes, boilerplate from templates. Workspace edits allowed, everything else asks; stops and reports up on anything ambiguous |
| `build` (dispatch role) | host's build agent | Optional stronger-model escalation for judgment-heavy coding; normally dispatched by `coder`. If unavailable, the coder codes itself or reports the gap |
| `janus-memory` (MCP) | — | Local SQLite memory shared across the agents: auto-saved consultation records, recall, edit, delete, outcome feedback |

### Which agent should I use?

```text
General question / unsure          -> janus
Consulting, selection, verify,
research, plan, durable document   -> consultant
Coding, debug, refactor, tests     -> coder
Quick fact / concept / how-to      -> lite
```

Start at `janus` when unsure; start directly at the specialist when you already know the task type. `coder-lite` and `build` are normally dispatched by `coder`, not selected directly.

Every agent's model is configurable (`*_model` fields), and every prompt layers a role asset with an optional model-adaptation block keyed by the model (`model_prompts` map overrides the shipped `assets/model-prompts/` library, extendable by dropping a file) — swap a model, keep the role, and the driving notes follow the model. The block describes the model, never the role: a model profile plus agent-actionable operating notes for using its strengths and controlling its weaknesses; runtime settings stay in config, and the same block serves every agent running that model. Blocks are matched **provider-agnostically**: a model id is normalized by dropping the provider prefix (everything before the last `/`), lowercasing, and keeping only letters and digits, so `deepseek/deepseek-v4-pro` and `opencode-go/deepseek-v4-pro` both resolve to the same key `deepseekv4pro` (see [Model-adaptation prompts](docs/deployment.md#model-adaptation-prompts)).

## Prerequisites

- [OpenCode](https://opencode.ai) (the agent harness)
- [Bun](https://bun.sh) >= 1.1 (runs the local memory MCP server and the installer)
- The shipped model defaults assume an **OpenCode Go subscription** for the `opencode-go/*` pool models, plus the `opencode` provider for the writer (`claude-sonnet-5-5`) and critic/verifier (`gemini-3.8-flash`, Zen pay-per-use). Without these, set every `*_model` to a provider configured on your machine — see the [non-Go example](docs/deployment.md) in the deployment guide. Dispatch failures print a remediation hint naming the exact config field.

## Install

```bash
git clone https://github.com/Arrowyi/janus-agent-plugin.git
cd janus-agent-plugin
bun install

# Build and install the packaged bundle into ~/.local/share/janus-agent-plugin
bun run install:local
```

Register the printed entry in `~/.config/opencode/opencode.json` (create if missing):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:///home/you/.local/share/janus-agent-plugin/dist/index.js"]
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

**Daily questions go to `lite`.** Select the `lite` agent for quick lookups and explanations at a fraction of the cost; it escalates to `consultant` (one line, with a reason) when a question needs multi-source adversarial verification or is high-stakes. **Coding goes to `coder`**, which picks the lightest process that fits: a direct fix for a one-line change, a brief plan for a small feature, and a design gate plus quality gate for multi-file or correctness-critical work.

**Memory.** Consultations auto-save (question + conclusion summaries — never transcripts). Browse and manage them with the `/janus-memory` command or the `janus-memory` CLI. Prior experience and preferences surface in later consultations, with an outcome-feedback loop.

**Configuration.** Optional JSONC config at `~/.config/janus-agent/config.jsonc` (or `$JANUS_CONFIG` / XDG): per-agent models and model-prompt blocks, agent names, enable flags, team caps, memory and embedding settings. The full field reference lives in [docs/deployment.md](docs/deployment.md).

**Verify your install:**

```bash
JANUS_PLUGIN_ENTRY=~/.local/share/janus-agent-plugin/dist/index.js bun run integration
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
