# Janus Agent Plugin — Reference Design

- Date: 2026-10-24
- Status: current (Role Family B)
- Scope: the shipped agent family, prompt assembly, routing, permissions, and verification.

## 1. Positioning

The plugin ships one default entry and three direct-entry shortcuts:

- `janus` — default general entry. Handles general questions, light tasks, and routing.
- `consultant` — evidence entry. Owns the six consultation modes and the research team.
- `coder` — coding entry. Owns coding, debugging, refactoring, tests, and the quality gate.
- `lite` — economical quick-answer leaf. Handles low-risk facts, concepts, and simple how-to.

A user who already knows the task type can start at `consultant`, `coder`, or `lite`; a user who is unsure starts at `janus`. The specialist entries are not peers of the default: `janus` is the router, and `consultant`/`coder` also serve as dispatch targets for bounded work.

## 2. Role map

| Role | Layer | Mode | Owns | Does not own |
|---|---|---|---|---|
| `janus` | entry | all | general questions, light tasks, routing | deep evidence, heavy coding, memory records |
| `consultant` | entry | primary | evidence grading, decisions, research, plans, durable documents | code implementation, daily coding |
| `coder` | entry | all | coding, debugging, refactoring, tests, repo work, quality gate | consulting/selection, source grading, research reports |
| `lite` | entry | all | quick facts, concepts, simple how-to | multi-source evidence, coding, complex planning |
| `explorer` | research | subagent | source gathering, metadata, initial grade | interpretation, final recommendation |
| `analyst` | research | subagent | independent interpretation, cross-model review | gathering, final answer |
| `critic` | research | subagent | counter-evidence, alternatives, conclusion challenge | source-intent audit, final answer |
| `verifier` | research | subagent | source intent and independence audit | fact-checking, final answer |
| `writer` | research | subagent | author-mode drafting and editorial review | research, final files, fact-checking |
| `coder-lite` | coding | subagent | fully specified mechanical coding/file tasks | judgment, debugging, cross-module, security-sensitive work |
| `build` | delegation | host | optional stronger-model coding escalation | plugin policy, final answer |

`build` is not a plugin-registered agent. It is a dispatch role that targets the host's build agent by name and optionally pins a model.

## 3. Routing

```text
janus       -> consultant / coder / lite / explorer (bulk retrieval)
consultant  -> explorer / analyst / critic / verifier / writer
consultant  -> lite (bounded quick answer)
consultant  -> coder (bounded code example)
coder       -> coder-lite / build (optional)
lite        -> none (leaf)
research    -> none (leaf)
coder-lite  -> none (leaf)
build       -> none (host agent)
```

`coder` never dispatches `consultant`; that would create a cycle. Evidence flows to the consultant, code flows to the coder. `lite` is a leaf and never dispatches. `janus` is the only entry that can reach both hubs.

## 4. Coder process weight

The coder selects the lightest process that fits and announces it in one line before working.

| Weight | Triggers | Process | User gate |
|---|---|---|---|
| L0 Direct | one-line fix, typo, rename, formatting/lint, config value, small test, copy-adapt; diff describable in one sentence | read target + nearest pattern; minimal edit; nearest verification; report diff/output | one-line intent; no approval |
| L1 Brief plan | one/few files; clear requirements; existing pattern; reproducible bug; local design choice | 3-5 bullet plan; TDD for behavior changes; implement; targeted verification; report | plan shared; no approval unless asked |
| L2 Design + plan | multi-file/module; API/schema/migration; unfamiliar code; more than one plausible design | explore; design gate (Goal/Context/Constraints/Done-when + 2-3 options + recommendation + files + risks + verification); plan; small steps; independent review; full verification | design block; wait for approval before editing |
| L3 Quality gate | concurrency, idempotency, replay, transactions, distributed failure, DB migration/constraints, auth, money/billing, data deletion, production config, crypto/keys; irreversible/high blast radius | L2 plus four-column pre-analysis, reference pattern, schema/constraint read, idempotency/concurrency/failure analysis, red-green proof, diff against pattern, independent review, destructive-action approval | design + quality-gate plan; wait for approval |

The weight is revised upward when new information appears; it is never silently downgraded because a task is taking longer than expected. Skills are selected by weight: L0 uses none; L1 uses TDD/systematic-debugging/verification when relevant; L2 adds brainstorming/writing-plans/requesting-code-review; L3 adds the full quality gate. A skill's default gate does not override the L0/L1 direct path.

When `coder` is dispatched with a bounded task, it does not ask the end user questions or wait for a user-facing gate; it makes assumptions, uses the lightest process, and returns the diff, verification output, and residual risks.

## 5. Prompt assembly

Every plugin-owned agent prompt is three layers:

1. **Role asset** — `assets/agents/<agent>.md`: identity, ownership, process, interaction, failure behavior.
2. **Model-adaptation block** — `assets/model-prompts/<normalized-model-key>.md`: model traits and operating notes. The block is keyed by model, not role, and is provider-agnostic. A model with no block gets none.
3. **Runtime bindings** — injected by the adapter: the agent's model, its dispatch targets, job-tool discipline, memory availability, caps, and namespace where relevant.

Role assets are model-agnostic. Model-specific traits never live in a role asset, and role rules never live in a model block.

## 6. Config and models

Defaults:

| Role | Default model |
|---|---|
| `janus` | `opencode-go/glm-5.3` |
| `consultant` | `opencode-go/glm-5.3` |
| `coder` | `opencode-go/glm-5.3` |
| `lite` | `opencode-go/deepseek-v4.1-flash` |
| `explorer` | `opencode-go/deepseek-v4.1-flash` |
| `analyst` | `opencode-go/qwen3.8-max` |
| `critic` | `opencode/gemini-3.8-flash` |
| `verifier` | `opencode/gemini-3.8-flash` |
| `writer` | `opencode/claude-sonnet-5-5` |
| `coder-lite` | `opencode-go/glm-5.3-flash` |
| `build` | host default (optional `build_model`) |

Every role resolves to a single configured model. There is no plugin fallback chain. A user can override any role with `<role>_model` in `~/.config/janus-agent/config.jsonc`.

The intended cross-family audit is consultant (GLM) ≠ analyst (Qwen) ≠ critic (Gemini). If a user overrides those roles onto one model family, the independence of the audit is reduced; the plugin does not enforce model diversity.

## 7. Permissions and dispatch

- `janus` and `coder` are full execution seats with host-default permissions.
- `consultant` is a primary evidence seat; it may write approved author-mode files but does not implement production code.
- `lite` can read/search, write only inside its workspace, and cannot dispatch (`task: deny`).
- The five research subagents are read-only and leaf nodes: `edit: deny`, `bash: deny`, `task: deny`.
- `coder-lite` can edit the workspace, asks for external edits, and cannot dispatch (`task: deny`); it is step-capped at 50.

All dispatch roles use the recoverable lifecycle: `janus_dispatch`, `janus_dispatch_wait`, `janus_dispatch_cancel`. Pending/unknown is not failure; wait on the same job. There is no automatic fallback model.

## 8. Memory

`consultant` and `lite` share the consultation memory namespace. Both auto-save one consultation record when serving the user directly; a dispatched bounded task does not save (the dispatcher owns the record). `janus`, `coder`, and `coder-lite` do not attach to consultation memory; coding sessions use the repo's `AGENTS.md` and project docs.

## 9. Verification

The shipped gate is:

```bash
bun test
bun run typecheck
bun run install:local
JANUS_PLUGIN_ENTRY=~/.local/share/janus-agent-plugin/dist/index.js bun run integration
```

The integration proof loads the installed artifact in an isolated OpenCode sandbox and asserts the agent keys, the memory MCP, the skill, the lite workspace, and the dispatch primitives. Model-graded behavior (routing, adaptive process, dispatched-mode discipline) is covered by `evals/fixtures/consultation-cases.json` and requires a live-model review.
