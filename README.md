# consultation-agent-plugin

An evidence-driven consultation agent plugin for [OpenCode](https://opencode.ai) with a portable, user-approved memory core.

The public experience is a single `consultant` primary agent with six modes: `select` (choose among candidates), `verify` (verdict on a claim), `plan` (an actionable plan), `guide` (a composite operational playbook for an end-to-end goal), `research` (understand a topic deeply, delivered as a readable report), and `author` (a durable technical document — tutorial, architecture analysis, or technical explanation — delivered behind one outline-approval gate). It separates verified facts from inference, audits user-generated sources for deliberate deception, and grades evidence. A local SQLite-backed memory system auto-saves consultation records (question + conclusion summaries), supports browse/edit/delete plus an outcome-feedback loop, and is shared across agents. Canonical records stay independent of classification, summarization, and embedding models.

## Usage

Select the `consultant` agent and ask anything. The consultant detects what kind of question it is and routes to one of six modes — and it tells you which mode it picked plus a one-line reason (e.g. "这是个购买决策 → select") before answering:

| Mode | When it triggers | You get |
|------|------------------|---------|
| `select` | choosing among candidates — 买哪个、选课、选工具 | a candidate list with per-candidate evidence grade, contamination note, and trial advice |
| `verify` | checking a claim or rumor — 这说法是不是真的 | a true / false / unverifiable verdict with a per-claim reasoning chain |
| `plan` | an actionable plan — 健身、保养、学习路线 | a step plan with support level, basis, risk, alternatives, and a robustness review |
| `guide` | a composite end-to-end operational package — 攻略、X入门、guide to X | an operational playbook: bottom line, suitability + prerequisites, a recommendation table, a procedure table, background/pitfalls, a completion check, and a next step |
| `research` | understanding a topic deeply — 深度研究、调查一下、开放话题 | a readable report: bottom line first, plain-language key points, what it means, with evidence and disagreements folded away |
| `author` | a durable document to keep or share — 教程、课程、架构分析文档、write-up | a tutorial, architecture analysis, or technical explanation behind one outline approval, delivered inline / single file / multi-file with light, targeted, or strict verification: document map, artifact paths, and a verification summary |

Routing is two-axis: the **mode** (what to deliver) is detected from intent, and the **tier** (fast / standard / deep) is chosen from risk and complexity. Simple questions get a one-line answer; complex ones get the mode's brief.

Browse or manage saved consultations with the `/consultation-memory` command (list, view, delete, keep-only) in the TUI, or the `consultation-memory` CLI offline.

## Architecture

```text
User -> OpenCode Adapter -> Consultant Agent
                              |
                              v
                          Consultation Skill
                              |
                              v
                        Consultation Core (tier routing, source grading, decision brief)
                              |
                              v
                          Memory Port
                              |
                              v
                          Memory MCP (local stdio, 5 tools)
                              |
                              v
                          Memory Core (schemas, revision states, retrieval planning)
                              |
                              v
                          SQLite Canonical Ledger + Rebuildable Indexes (FTS5, embeddings)
```

Core packages are harness-neutral (no OpenCode, no MCP SDK, no SQLite imports). Adapters translate host and transport concepts into core ports. See [docs/architecture.md](docs/architecture.md) for the full architecture specification.

## Package Map

| Package | Path | Role |
|---------|------|------|
| `@consultation-agent/consultation-core` | `packages/consultation-core/` | Tier routing, source grading, budget enforcement, decision and author brief validation, ports |
| `@consultation-agent/memory-core` | `packages/memory-core/` | Canonical schemas, revision state machine, retrieval planning, injection/secret detection, MemoryStore port |
| `@consultation-agent/memory-sqlite` | `packages/memory-sqlite/` | SQLite + FTS5 store implementation, migrations, writer lock, XDG paths, CLI |
| `@consultation-agent/memory-mcp` | `packages/memory-mcp/` | Local stdio MCP server exposing 5 memory tools |
| `@consultation-agent/opencode-adapter` | `packages/opencode-adapter/` | Thin OpenCode plugin: registers the consultant agent, the five read-only team subagents, memory MCP, and consultation skill via the `config` hook |

Assets live under `assets/`:
- `assets/agents/consultant.md` - the primary-agent prompt
- `assets/agents/explorer.md`, `assets/agents/analyst.md`, `assets/agents/consultation-critic.md`, `assets/agents/consultation-verifier.md` - the read-only team prompts
- `assets/agents/writer.md` - the read-only writing-blueprint prompt for `author` mode; the writer is plugin-owned and optional (`writer_enabled`, default true)
- `assets/skills/consultation/SKILL.md` - the reusable consultation skill

## Quickstart

```bash
# 1. Install dependencies (Bun only)
bun install

# 2. Build and install the packaged bundle
#    Stages dist/ + assets/ into ~/.local/share/consultation-agent-plugin
#    and prints the plugin entry to use.
bun run install:local

# 3. Register the installed bundle
#    Add the printed entry to ~/.config/opencode/opencode.json:
#    { "plugin": ["file:///Users/you/.local/share/consultation-agent-plugin/dist/index.js"] }

# 4. Restart OpenCode

# 5. Select the "consultant" agent and ask a question
```

**Deployment rule:** always deploy the packaged bundle. Never point an OpenCode config at `packages/opencode-adapter/src/index.ts` — this project ships to other users, so a deployment must not depend on the repo checkout or its `node_modules`. See [docs/deployment.md](docs/deployment.md#deployment-rule).

## Common Commands

```bash
bun install                  # install dependencies
bun test                     # run all unit tests
bun run typecheck            # tsc --noEmit (static gate)
bun run build                # bundle adapter + memory-mcp server into dist/
bun run install:local        # build, then install the bundle into the install prefix
bun run integration          # isolated OpenCode integration proof (skips if opencode is absent)
bun run evals/run-evals.ts   # print the evaluation checklist
```

## Documentation

- [docs/deployment.md](docs/deployment.md) - detailed local deployment guide
- [docs/architecture.md](docs/architecture.md) - full architecture specification
- [evals/README.md](evals/README.md) - evaluation fixtures and two-tier grading

## Tech Stack

Bun >= 1.1, TypeScript strict, zod ^3.25, @modelcontextprotocol/sdk ^1.29, SQLite FTS5. No native dependencies. One Bun workspace with five internal packages.
