# Local Deployment Guide

This guide covers installing the consultation-agent plugin into a local OpenCode setup.

## Deployment Rule

**Deploy only the packaged bundle. Never point an OpenCode config at this repo's source.**

This project is distributed to other users, so a deployment must be reproducible from build artifacts alone: it may not depend on the repo checkout, its `node_modules`, or Bun's module cache. Concretely:

- Build and install with `bun run install:local`; it builds `dist/`, stages `dist/` + `assets/` into the install prefix, and verifies the result.
- Point the OpenCode `plugin` entry at the **installed** `dist/index.js`, never at `packages/opencode-adapter/src/index.ts`.
- The installed bundle must stay self-contained: `script/build.ts` marks nothing external, and the memory MCP server resolves to the bundled `memory-mcp-server.js` sibling, so no `node_modules` ships with it.
- Source-mode entries are for this repo's own test runs only (`bun test`, `bun run integration`), never for a working setup or a release.

Any change that reintroduces an external runtime import, or a config entry pointing at source, violates this rule. `bun test` guards the resolution logic and `bun run integration` proves the installed artifact registers correctly.

## Prerequisites

- **Bun >= 1.1** - the runtime and package manager. Install from <https://bun.sh>.
- **OpenCode** - the agent harness. Install from <https://opencode.ai> or your package manager. Verify with `opencode --version`.
- **Model providers** — the shipped defaults (`opencode-go/*`, `opencode/claude-sonnet-5`) assume an **OpenCode Go subscription**. Without one, the agents register but fail at model resolution when used. Non-Go users: copy the config below into `~/.config/consultation-agent/config.jsonc` and set every `*_model` to a provider configured on your machine. Dispatch failures print this remediation hint with the exact field name.

  ```jsonc
  {
    "agent_model": "<your-provider>/deepseek-v4-pro-or-equivalent",
    "explorer_model": "<your-provider>/fast-cheap-model",
    "analyst_model": "<your-provider>/reasoning-model",
    "critic_model": "<your-provider>/different-family-model",
    "verifier_model": "<your-provider>/different-family-model",
    "writer_model": "<your-provider>/writing-model",
    "writer_fallback_models": ["<your-provider>/fallback-model"],
    "simple_model": "<your-provider>/fast-cheap-model",
    "build_lite_model": "<your-provider>/mechanical-coding-model",
    "build_model": "<your-provider>/strong-coding-model"
  }
  ```

Bun and OpenCode must be on your `PATH`.

## Step 1: Install Dependencies

Clone this repository and install its dependencies. Bun is the only package manager; never use npm, yarn, or pnpm.

```bash
git clone <repo-url> consultation-agent-plugin
cd consultation-agent-plugin
bun install
```

## Step 2: Build, Install, and Register

Build the bundle and install it into a stable prefix:

```bash
bun run install:local
```

The installer stages `dist/` + `assets/` into the install root (default `~/.local/share/consultation-agent-plugin`; override with `CONSULTATION_INSTALL_DIR`), writes `package.json` + `build-meta.json` for provenance, and fails if any required file is missing. It prints the exact plugin entry to add to `~/.config/opencode/opencode.json` (create the file if missing):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:///Users/you/.local/share/consultation-agent-plugin/dist/index.js"]
}
```

Installed layout:

```text
<install root>/
  dist/index.js               bundled adapter plugin (self-contained)
  dist/memory-mcp-server.js   bundled memory MCP server (self-contained)
  assets/agents/*.md          agent prompts (read at startup)
  assets/skills/consultation/SKILL.md
  package.json                provenance
  build-meta.json             version / git sha / build time
```

Re-running `bun run install:local` rebuilds and replaces the installed bundle. Restart OpenCode afterwards to load it.

The installed plugin ships every prompt it needs, including `assets/agents/writer.md`, and does not require OMO, Janus, global agent files under `~/.config/opencode/agents/`, external skills, or the source checkout at runtime. Missing writer capability degrades to disclosed inline work: the consultant must not claim an independent blueprint or chapter draft was produced.

### Development only: source mode

For iterating on this repo (unit tests, the integration proof, or a throwaway session), a plugin entry may point at `packages/opencode-adapter/src/index.ts`. Bun runs TypeScript directly, so no build is needed, but this mode requires the repo checkout and its `node_modules` to be present. It must never be used for an installed deployment or a release.

## Step 3: Restart OpenCode

Restart OpenCode so it picks up the new plugin entry. On startup the plugin's `config` hook runs and:
1. registers the `consultant` primary agent;
2. registers the `simple` agent (mode `all`: selectable as a primary agent and dispatchable), on the configured model, with patterned permissions — read tools allowed, read-only bash commands allowed, its own workspace directory (`$XDG_DATA_HOME/consultation-agent/simple`) writable without asking, every other write asking;
3. registers the five team subagents `consultation-explorer`, `consultation-analyst`, `consultation-critic`, `consultation-verifier`, `consultation-writer` (each read-only, each on its configured model; the verifier reuses the critic's model by default; the writer also denies shell execution);
4. registers the `consultation-memory` local MCP server (when memory is enabled, the default);
5. registers `consultation_dispatch{role,prompt}`, `consultation_dispatch_wait{job_id,wait_ms?}` and `consultation_dispatch_cancel{job_id}` for the six dispatch roles (these do not interfere with the built-in `task` tool or other plugins);
6. installs the `consultation` skill and the `consultation-memory` browse command into your OpenCode config directory.

### Recoverable team jobs

All roles share the same recoverable dispatch lifecycle; only the bundled writer has a configured model-fallback chain. Launch observes for a 300000 ms soft wait window. Expiry returns a recoverable job envelope, not specialist failure, and never aborts the child. Wait uses the same `job_id`, including after a coordinator restart; `wait_ms` is an optional integer 0..300000 (default 300000; zero is a snapshot). Pending/unknown jobs must not trigger duplicate launches, backup models, or silent inline substitution. The consultant integrates the eventual original report and discloses any unresolved independent check.

Cancel is explicit and may return `cancelling` until durable abort evidence confirms `cancelled`; normal completion racing cancellation wins and returns the report. Nonterminal envelopes name `consultation_dispatch_wait` as their next action. Wait/cancel use the caller's parent session and workspace for ownership, not routing overrides. See [the architecture API contract](architecture.md#64-recoverable-dispatch-api).

## Step 4: Optional Plugin Configuration

The plugin reads an optional JSONC config file. Default locations (first found wins):

1. `$CONSULTATION_CONFIG` - explicit path override
2. `$XDG_CONFIG_HOME/consultation-agent/config.jsonc`
3. `~/.config/consultation-agent/config.jsonc`

A missing file is fine; all fields have defaults. Create the file to override defaults:

```jsonc
{
  // Models for the consultant and its five team subagents. All are optional;
  // the defaults below ship with the plugin and are tuned for cross-model
  // verification (consultant vs analyst vs critic use different families;
  // the verifier reuses the critic's model by configuration, keeping it
  // different from the analyst; this is not a claim of model superiority).
  "agent_model": "opencode-go/deepseek-v4-pro",
  "explorer_model": "opencode-go/deepseek-v4.1-flash",
  "analyst_model": "opencode-go/qwen3.8-max",
  "critic_model": "opencode-go/glm-5.3",
  "verifier_model": "opencode-go/glm-5.3",
  "writer_model": "opencode/claude-sonnet-5",

  // Bundled writer only: on confirmed terminal retryable model errors
  // the dispatch tool walks the fallback chain in order. Defaults shown.
  // Pending, unknown and non-retryable errors never trigger fallback.
  "writer_fallback_models": ["opencode-go/kimi-k3"],
  // Prefer a stronger host-provided writing agent over the bundled one.
  // When set, the bundled writer is not registered; dispatch routes to this
  // agent and only pins a model when writer_delegate_model is also set.
  // "writer_delegate_agent": "host-writer",
  // "writer_delegate_model": "provider/model",

  // simple — the economical daily-consultation agent (mode: all).
  "simple_agent": "simple",
  "simple_model": "opencode-go/deepseek-v4.1-flash",
  "simple_enabled": true,
  // simple's pre-approved writable workspace. Default shown; any absolute path.
  // "simple_workspace_dir": "~/.local/share/consultation-agent/simple",
  // Optional per-model adaptation block, keyed by the exact model id —
  // overrides the shipped block for that model ("": disables it).
  // "simple_model_prompts": { "opencode-go/deepseek-v4.1-flash": "…" },

  // build-lite — the mechanical coding lane (mode: subagent, leaf, steps 50).
  // Workspace edits are allowed without asking; external edits ask.
  "build_lite_agent": "build-lite",
  "build_lite_model": "opencode-go/glm-5.3-flash",
  "build_lite_enabled": true,

  // build — a dispatch role targeting the host's native build agent by name.
  // The plugin registers no build agent; when the role fails (agent missing or
  // model unresolvable), the dispatch prints a remediation hint.
  "build_agent": "build",
  // "build_model": "provider/model",   // pin only when the host default is wrong
  "build_enabled": true,

  // Subagent names. Rename only if they clash with an existing agent.
  "explorer_agent": "consultation-explorer",
  "analyst_agent": "consultation-analyst",
  "critic_agent": "consultation-critic",
  "verifier_agent": "consultation-verifier",
  "writer_agent": "consultation-writer",

  // Whether to register the critic, verifier, and writer subagents. Default true.
  "critic_enabled": true,
  "verifier_enabled": true,
  "writer_enabled": true,

  // Team loop and fan-out caps. All optional; defaults shown.
  "team_caps": {
    "round_cap": 3,          // explore->critique->synthesize rounds
    "explorer_cap": 5,       // max parallel explorers
    "critic_search_cap": 5   // max critic verification searches per round
  },

  // Max instances per role per tier (explorer/analyst/critic/verifier/writer),
  // never minimum dispatch counts or a required team roster.
  // All optional; defaults shown. A legacy matrix without `writer` still parses;
  // `writer` then defaults to 0 in the supplied tiers.
  "tier_role_caps": {
    "fast":     { "explorer": 5, "analyst": 0, "critic": 0, "verifier": 0, "writer": 0 },
    "standard": { "explorer": 5, "analyst": 1, "critic": 1, "verifier": 1, "writer": 1 },
    "deep":     { "explorer": 5, "analyst": 3, "critic": 2, "verifier": 2, "writer": 2 }
  },

  // Advisory stop-loss per provider (USD). Default 10.
  "cost_guard_provider_usd": 10,

  // Install the consultation skill into the OpenCode config dir. Default true.
  "install_skill": true,

  // Enable the memory MCP server (recall, expand, prepare, commit, manage).
  // Set false to disable saving and recall entirely. Default true.
  "memory_enabled": true,

  // Optional semantic retrieval via an OpenAI-compatible embedding endpoint.
  // Without this block, retrieval works via taxonomy + FTS only.
  "embedding": {
    "base_url": "https://api.openai.com/v1",
    // Name of the environment variable holding the API key (not the key itself).
    "api_key_env": "OPENAI_API_KEY",
    "model": "text-embedding-3-small",
    "dimensions": 1536
  }
}
```

### Field Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `agent_model` | string (optional) | `opencode-go/deepseek-v4-pro` | Model for the `consultant` agent |
| `explorer_agent` | string | `"consultation-explorer"` | Name of the search/gathering subagent |
| `explorer_model` | string (optional) | `opencode-go/deepseek-v4.1-flash` | Model for the explorer subagent |
| `analyst_agent` | string | `"consultation-analyst"` | Name of the analysis subagent |
| `analyst_model` | string (optional) | `opencode-go/qwen3.8-max` | Model for the analyst subagent |
| `critic_agent` | string | `"consultation-critic"` | Name of the adversarial critic subagent |
| `critic_model` | string (optional) | `opencode-go/glm-5.3` | Model for the critic subagent |
| `critic_enabled` | boolean | `true` | Whether to register the critic subagent |
| `verifier_agent` | string | `"consultation-verifier"` | Name of the bounded source-influence and independence-audit subagent |
| `verifier_model` | string (optional) | `opencode-go/glm-5.3` | Model for the verifier subagent |
| `verifier_enabled` | boolean | `true` | Whether to register the verifier subagent |
| `writer_agent` | string | `"consultation-writer"` | Name of the blueprint/review and approved-section-drafting subagent (`author` mode) |
| `writer_model` | string (optional) | `opencode/claude-sonnet-5` | Primary model for the writer subagent |
| `writer_fallback_models` | string[] (optional) | `["opencode-go/kimi-k3"]` | Bundled-writer chain tried only after confirmed terminal retryable model errors, in order; never for pending/unknown/non-retryable outcomes or delegate writer |
| `writer_delegate_agent` | string (optional) | (none) | Host-provided writing agent preferred over the bundled writer; the bundled writer is not registered when set, and its permissions are controlled by the host |
| `writer_delegate_model` | string (optional) | (none) | Model pinned on the delegate agent; when unset the delegate uses its own model |
| `writer_enabled` | boolean | `true` | Whether to register the writer subagent |
| `simple_agent` | string | `"simple"` | Name of the economical daily-consultation agent (mode `all`) |
| `simple_model` | string (optional) | `opencode-go/deepseek-v4.1-flash` | Model for the simple agent |
| `simple_enabled` | boolean | `true` | Whether to register the simple agent |
| `simple_workspace_dir` | string (optional) | `$XDG_DATA_HOME/consultation-agent/simple` | simple's pre-approved writable workspace (absolute path) |
| `build_lite_agent` | string | `"build-lite"` | Name of the mechanical coding lane (mode `subagent`, leaf node) |
| `build_lite_model` | string (optional) | `opencode-go/glm-5.3-flash` | Model for the build-lite lane |
| `build_lite_enabled` | boolean | `true` | Whether to register the build-lite lane |
| `build_agent` | string | `"build"` | Target agent name for the `build` dispatch role (the host's native build agent by default) |
| `build_model` | string (optional) | (none — host default) | Model pinned on the `build` role's target agent |
| `build_enabled` | boolean | `true` | Whether the `build` dispatch role accepts work |
| `team_caps.round_cap` | number | `3` | Rounds of explore->critique->synthesize before forced synthesis |
| `team_caps.explorer_cap` | number | `5` | Max parallel explorer instances |
| `team_caps.critic_search_cap` | number | `5` | Max critic verification searches per round |
| `tier_role_caps.*` | object | fast `5/0/0/0/0`, standard `5/1/1/1/1`, deep `5/3/2/2/2` | Advisory maximum instances per role per tier, never minimum calls; a supplied matrix without `writer` resolves it to 0 |
| `cost_guard_provider_usd` | number | `10` | Advisory stop-loss per provider (converge when approaching) |
| `install_skill` | boolean | `true` | Whether to install the consultation skill into the OpenCode config dir |
| `install_commands` | boolean | `true` | Whether to install the `consultation-memory` browse slash command |
| `memory_enabled` | boolean | `true` | Whether to register and launch the memory MCP server |
| `embedding.base_url` | string | (none) | OpenAI-compatible embedding API base URL |
| `embedding.api_key_env` | string | (none) | Name of the env var holding the embedding API key |
| `embedding.model` | string | (none) | Embedding model name |
| `embedding.dimensions` | number | (none) | Embedding vector dimensions |

The `embedding` block is all-or-nothing: set all four sub-fields or omit the block.

Non-writer roles and delegate writer each have one configured attempt, with no plugin fallback advance. A delegate without `writer_delegate_model` uses host model selection (`null` in the durable job spec); it keeps host permissions and host-internal retry behavior. Neither wait expiry nor unknown observation authorizes a backup model.

The consultant routes bounded tasks to suitable specialist agents: `explorer` gathers missing evidence, `analyst` interprets material disputes, `critic` independently challenges consequential conclusions, `verifier` triages unclear influence or independence of user/third-party/promotional sources, and `writer` produces a blueprint before outline approval or usable section/chapter prose afterward. A potentially relevant check is delegated when its necessity cannot be ruled out; a role is skipped only with a task-specific reason. These roles are not a tier-dependent required roster. Plugin-owned subagents have `permission.edit = "deny"`; the bundled writer also has `permission.bash = "deny"`. An external `writer_delegate_agent` keeps its host-defined permissions and does not inherit these restrictions. Analyst follows evidence, critic follows a draft conclusion, writer's substantive prose follows approved scope and evidence, and the consultant verifies, integrates and writes final files. The default consultant, analyst and critic use different model families; verifier reuses critic's configured model, without a performance guarantee from that choice. Role caps are advisory ceilings rather than a runtime-enforced scheduler. Bounded, low-risk simple-consultation and search subtasks may route to the `simple` generalist instead; answers produced through simple are relayed in simple's answer-first format, and a specialist profile is never substituted by simple. Coding routes through two lanes: fully specified mechanical coding and file tasks go to the `build-lite` lane (workspace edits allowed, external edits ask, further dispatch denied — its stop-and-report is a legitimate partial outcome the dispatcher integrates); judgment-heavy coding goes to the `build` role targeting the host's native build agent, and when that fails the dispatch prints a remediation hint naming `build_agent`/`build_model`.

### Model-adaptation prompts

Every plugin-owned agent's prompt assembles in three layers: the role asset
(`assets/agents/<agent>.md` — identity, scope, workflow, discipline) plus a
model-adaptation block plus the runtime bindings. The model block resolves per
agent: your `<agent>_model_prompts` map entry for the exact resolved model id
wins (an explicit `""` disables it); otherwise the shipped default block
(`assets/model-prompts/<agent>.md`, currently shipped for `simple` and
`build-lite` only) applies only while the agent runs its default model; an
agent whose model you swapped runs the role prompt alone unless you provide a
block — default-model advice is never injected into a different model.

To adapt an agent to your own model: read the shipped block for its default
model as a template (`assets/model-prompts/simple.md`,
`assets/model-prompts/build-lite.md`), write your block for your model, and set
it under the agent's `_model_prompts` key. The eight keys are `agent_model_prompts`
(consultant), `explorer_model_prompts`, `analyst_model_prompts`,
`critic_model_prompts`, `verifier_model_prompts`, `writer_model_prompts`,
`simple_model_prompts`, and `build_lite_model_prompts`. The `build` role and
delegated writers target host-owned agents and take no model prompts.

## Data, State, and Cache Paths

The memory SQLite store uses XDG Base Directory paths with environment overrides:

| Path | Default | What lives there |
|------|---------|------------------|
| Data | `$XDG_DATA_HOME/consultation-agent/` (default `~/.local/share/consultation-agent/`) | `memory.sqlite3` and user-controlled exports |
| State | `$XDG_STATE_HOME/consultation-agent/` (default `~/.local/state/consultation-agent/`) | Writer lock, pending enrichment state, operational records |
| Cache | `$XDG_CACHE_HOME/consultation-agent/` (default `~/.cache/consultation-agent/`) | Rebuildable query caches |

The database file defaults to `<dataDir>/memory.sqlite3`. Override with the `CONSULTATION_DATA_DIR`, `CONSULTATION_STATE_DIR`, and `CONSULTATION_CACHE_DIR` environment variables when launching the MCP server.

Canonical experience records (user-approved items, claims, evidence, decisions, preferences, revisions) live in the data directory. Derived artifacts (summaries, embeddings, FTS indexes, tags) are rebuildable and live alongside canonical data but can be deleted and rebuilt without losing accepted experience.

## Step 5: Verify the Install

1. **Agent selectable**: start OpenCode and confirm the `consultant` agent appears in the agent list.
2. **simple agent selectable**: the `simple` agent appears in the agent list (mode `all`) with its own workspace at `~/.local/share/consultation-agent/simple`.
3. **build-lite lane registered**: the `build-lite` agent appears as a subagent (steps 50, workspace-allow edits).
4. **Memory MCP starts**: the `consultation-memory` MCP server is registered. Its five tools (`memory_recall`, `memory_expand`, `memory_prepare`, `memory_commit`, `memory_manage`) are available to the consultant agent.
5. **Team subagents registered**: `consultation-explorer`, `consultation-analyst`, `consultation-critic`, `consultation-verifier`, and `consultation-writer` appear as subagents (mode `subagent`), dispatched by the consultant via the `consultation_dispatch` tool.
6. **Skill present**: the skill file exists at `~/.config/opencode/skills/consultation/SKILL.md` (or your `$OPENCODE_CONFIG_DIR/skills/consultation/SKILL.md`).

You can also run the automated integration proof:

```bash
bun run integration
```

This spawns an isolated OpenCode server in a temp sandbox (never touching your real config or DB), loads the plugin, and asserts the agent, MCP, and skill are registered. It prints a PASS/FAIL summary per assertion. If `opencode` is not on PATH, it prints SKIP and exits 0.

By default it loads the packaged `dist/index.js`. To prove an installed bundle — the artifact the deployment rule requires — pass its path:

```bash
CONSULTATION_PLUGIN_ENTRY=~/.local/share/consultation-agent-plugin/dist/index.js bun run integration
```

## Running Tests, Typecheck, Build, and Install

```bash
bun test                     # all unit tests (co-located *.test.ts, bun:test)
bun run typecheck            # tsc --noEmit across the workspace
bun run build                # bundle adapter + memory-mcp into dist/
bun run install:local        # build, then install the bundle into the install prefix
bun run integration          # isolated OpenCode integration proof (skips if opencode is absent)
bun run evals/run-evals.ts   # print the evaluation checklist (no live model calls)
```

The evaluation fixtures under `evals/fixtures/` encode the architecture verification scenarios. Deterministic cases map to package unit tests; model-graded cases print a reviewer rubric. See [evals/README.md](../evals/README.md) for details.

## Uninstall

1. **Remove the plugin entry** from your OpenCode config. Edit `~/.config/opencode/opencode.json` and remove the `file://` entry from the `plugin` array.

2. **Remove the installed bundle:**

   ```bash
   rm -rf ~/.local/share/consultation-agent-plugin
   ```

   Or remove `$CONSULTATION_INSTALL_DIR` if you set one.

3. **Remove the installed skill** (optional):

   ```bash
   rm -rf ~/.config/opencode/skills/consultation
   ```

4. **Remove the plugin config file** (optional):

   ```bash
   rm -f ~/.config/consultation-agent/config.jsonc
   ```

   Or if you used `$XDG_CONFIG_HOME`:

   ```bash
   rm -f "$XDG_CONFIG_HOME/consultation-agent/config.jsonc"
   ```

5. **Remove the memory data, state, and cache** (optional, this deletes all stored experience):

   ```bash
   rm -rf ~/.local/share/consultation-agent
   rm -rf ~/.local/state/consultation-agent
   rm -rf ~/.cache/consultation-agent
   ```

   Or with custom XDG paths:

   ```bash
   rm -rf "$XDG_DATA_HOME/consultation-agent"
   rm -rf "$XDG_STATE_HOME/consultation-agent"
   rm -rf "$XDG_CACHE_HOME/consultation-agent"
   ```

6. **Remove simple's workspace (optional):** `rm -rf ~/.local/share/consultation-agent/simple`.

7. **Restart OpenCode** to confirm the plugin is no longer loaded.
