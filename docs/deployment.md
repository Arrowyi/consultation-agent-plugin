# Local Deployment Guide

This guide covers installing the janus-agent plugin into a local OpenCode setup.

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
- **Model providers** — the shipped defaults assume an **OpenCode Go subscription** for the `opencode-go/*` pool models, plus the `opencode` provider for the writer (`opencode/claude-sonnet-5-5`) and the critic/verifier (`opencode/gemini-3.8-flash`, Zen pay-per-use). Without these providers, the agents register but fail at model resolution when used. Non-Go users: copy the config below into `~/.config/janus-agent/config.jsonc` and set every `*_model` to a provider configured on your machine. Dispatch failures print this remediation hint with the exact field name.

  ```jsonc
  {
    "agent_model": "<your-provider>/strong-agentic-model",
    "explorer_model": "<your-provider>/fast-cheap-model",
    "analyst_model": "<your-provider>/reasoning-model",
    "critic_model": "<your-provider>/different-family-model",
    "verifier_model": "<your-provider>/different-family-model",
    "writer_model": "<your-provider>/writing-model",
    "coder_model": "<your-provider>/strong-coding-model",
    "lite_model": "<your-provider>/fast-cheap-model",
    "coder_lite_model": "<your-provider>/mechanical-coding-model",
    "build_model": "<your-provider>/strong-coding-model"
  }
  ```

Bun and OpenCode must be on your `PATH`.

## Step 1: Install Dependencies

Clone this repository and install its dependencies. Bun is the only package manager; never use npm, yarn, or pnpm.

```bash
git clone <repo-url> janus-agent-plugin
cd janus-agent-plugin
bun install
```

## Step 2: Build, Install, and Register

Build the bundle and install it into a stable prefix:

```bash
bun run install:local
```

The installer stages `dist/` + `assets/` into the install root (default `~/.local/share/janus-agent-plugin`; override with `JANUS_INSTALL_DIR`), writes `package.json` + `build-meta.json` for provenance, and fails if any required file is missing. It prints the exact plugin entry to add to `~/.config/opencode/opencode.json` (create the file if missing):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:///Users/you/.local/share/janus-agent-plugin/dist/index.js"]
}
```

Installed layout:

```text
<install root>/
  dist/index.js               bundled adapter plugin (self-contained)
  dist/memory-mcp-server.js   bundled memory MCP server (self-contained)
  assets/agents/*.md          agent prompts (read at startup)
  assets/model-prompts/*.md   model-adaptation blocks (keyed by model slug)
  assets/skills/consultation/SKILL.md
  package.json                provenance
  build-meta.json             version / git sha / build time
```

Re-running `bun run install:local` rebuilds and replaces the installed bundle. Restart OpenCode afterwards to load it.

The installed plugin ships every prompt it needs, including `assets/agents/writer.md`, and does not require OMO, an external janus agent, global agent files under `~/.config/opencode/agents/`, external skills, or the source checkout at runtime. Missing writer capability degrades to disclosed inline work: the consultant must not claim an independent blueprint or chapter draft was produced.

### Development only: source mode

For iterating on this repo (unit tests, the integration proof, or a throwaway session), a plugin entry may point at `packages/opencode-adapter/src/index.ts`. Bun runs TypeScript directly, so no build is needed, but this mode requires the repo checkout and its `node_modules` to be present. It must never be used for an installed deployment or a release.

## Step 3: Restart OpenCode

Restart OpenCode so it picks up the new plugin entry. On startup the plugin's `config` hook runs and:
1. registers the `consultant` primary agent;
2. registers the `coder` coding entry (mode `all`: selectable and dispatchable), the `lite` economical leaf (mode `all`, dispatch denied), and the `coder-lite` mechanical lane (mode `subagent`, steps 50, workspace edits allowed without asking, further dispatch denied);
3. registers the `lite` workspace directory (`$XDG_DATA_HOME/janus-agent/lite`) writable without asking; every other write asks;
4. registers the five research subagents `consultation-explorer`, `consultation-analyst`, `consultation-critic`, `consultation-verifier`, `consultation-writer` (each read-only, each on its configured model, each with shell and dispatch denied; the verifier reuses the critic's model by default);
5. registers the `janus-memory` local MCP server (when memory is enabled, the default);
6. registers `janus_dispatch{role,prompt}`, `janus_dispatch_wait{job_id,wait_ms?}` and `janus_dispatch_cancel{job_id}` for the ten dispatch roles (these do not interfere with the built-in `task` tool or other plugins);
7. installs the `consultation` skill and the `janus-memory` browse command into your OpenCode config directory.

### Recoverable team jobs

All roles share the same recoverable dispatch lifecycle; every agent resolves to a single configured model with no plugin fallback chain. Launch observes for a 300000 ms soft wait window. Expiry returns a recoverable job envelope, not specialist failure, and never aborts the child. Wait uses the same `job_id`, including after a coordinator restart; `wait_ms` is an optional integer 0..300000 (default 300000; zero is a snapshot). Pending/unknown jobs must not trigger duplicate launches, backup models, or silent inline substitution. The consultant integrates the eventual original report and discloses any unresolved independent check.

Cancel is explicit and may return `cancelling` until durable abort evidence confirms `cancelled`; normal completion racing cancellation wins and returns the report. Nonterminal envelopes name `janus_dispatch_wait` as their next action. Wait/cancel use the caller's parent session and workspace for ownership, not routing overrides. See [the architecture API contract](architecture.md#64-recoverable-dispatch-api).

## Step 4: Optional Plugin Configuration

The plugin reads an optional JSONC config file. Default locations (first found wins):

1. `$JANUS_CONFIG` - explicit path override
2. `$XDG_CONFIG_HOME/janus-agent/config.jsonc`
3. `~/.config/janus-agent/config.jsonc`

A missing file is fine; all fields have defaults. Create the file to override defaults:

```jsonc
{
  // Models for the agent family. All are optional; the defaults below ship
  // with the plugin and are tuned for cross-model verification (consultant vs
  // analyst vs critic use different families; the verifier reuses the critic's
  // model by configuration, keeping it different from the analyst; this is not
  // a claim of model superiority).
  "agent_model": "opencode-go/glm-5.3",
  "explorer_model": "opencode-go/deepseek-v4.1-flash",
  "analyst_model": "opencode-go/qwen3.8-max",
  "critic_model": "opencode/gemini-3.8-flash",
  "verifier_model": "opencode/gemini-3.8-flash",
  "writer_model": "opencode/claude-sonnet-5-5",

  // Optional global model-adaptation blocks, keyed by the provider-agnostic
  // normalized model key (see "Model-adaptation prompts" below) — overrides
  // the shipped library block for that model; an explicit "" disables it.
  // "model_prompts": { "deepseekv4pro": "…" },

  // Prefer a stronger host-provided writing agent over the bundled one.
  // When set, the bundled writer is not registered; dispatch routes to this
  // agent and only pins a model when writer_delegate_model is also set.
  // "writer_delegate_agent": "host-writer",
  // "writer_delegate_model": "provider/model",

  // coder — the coding entry (mode: all). Selects L0/L1/L2/L3 process weight
  // by task complexity; owns the quality gate and the coding lanes.
  "coder_agent": "coder",
  "coder_model": "opencode-go/glm-5.3",
  "coder_enabled": true,

  // lite — the economical quick-answer leaf (mode: all, dispatch denied).
  "lite_agent": "lite",
  "lite_model": "opencode-go/deepseek-v4.1-flash",
  "lite_enabled": true,
  // lite's pre-approved writable workspace. Default shown; any absolute path.
  // "lite_workspace_dir": "~/.local/share/janus-agent/lite",

  // coder-lite — the mechanical coding lane (mode: subagent, leaf, steps 50).
  // Workspace edits are allowed without asking; external edits ask.
  "coder_lite_agent": "coder-lite",
  "coder_lite_model": "opencode-go/glm-5.3-flash",
  "coder_lite_enabled": true,

  // build — an optional host-model escalation, normally dispatched by coder.
  // The plugin registers no build agent; when the role fails (agent missing or
  // model unresolvable), the dispatch prints a remediation hint.
  "build_agent": "build",
  // "build_model": "provider/model",   // pin only when the host default is wrong
  "build_enabled": true,

  // janus — the default general entry (mode: all). Routes consulting to
  // consultant, coding to coder, and quick answers to lite. No memory
  // attachment. Defaults to GLM-5.3, the same as consultant, so both share
  // the shipped glm53.md driving block.
  "janus_agent": "janus",
  // "janus_model": "opencode-go/glm-5.3",
  "janus_enabled": true,

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
  // All optional; defaults shown.
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
| `agent_model` | string (optional) | `opencode-go/glm-5.3` | Model for the `consultant` agent |
| `explorer_agent` | string | `"consultation-explorer"` | Name of the search/gathering subagent |
| `explorer_model` | string (optional) | `opencode-go/deepseek-v4.1-flash` | Model for the explorer subagent |
| `analyst_agent` | string | `"consultation-analyst"` | Name of the analysis subagent |
| `analyst_model` | string (optional) | `opencode-go/qwen3.8-max` | Model for the analyst subagent |
| `critic_agent` | string | `"consultation-critic"` | Name of the adversarial critic subagent |
| `critic_model` | string (optional) | `opencode/gemini-3.8-flash` | Model for the critic subagent |
| `critic_enabled` | boolean | `true` | Whether to register the critic subagent |
| `verifier_agent` | string | `"consultation-verifier"` | Name of the bounded source-influence and independence-audit subagent |
| `verifier_model` | string (optional) | `opencode/gemini-3.8-flash` | Model for the verifier subagent |
| `verifier_enabled` | boolean | `true` | Whether to register the verifier subagent |
| `writer_agent` | string | `"consultation-writer"` | Name of the blueprint/review and approved-section-drafting subagent (`author` mode) |
| `writer_model` | string (optional) | `opencode/claude-sonnet-5-5` | Model for the writer subagent |
| `writer_delegate_agent` | string (optional) | (none) | Host-provided writing agent preferred over the bundled writer; the bundled writer is not registered when set, and its permissions are controlled by the host |
| `writer_delegate_model` | string (optional) | (none) | Model pinned on the delegate agent; when unset the delegate uses its own model |
| `writer_enabled` | boolean | `true` | Whether to register the writer subagent |
| `coder_agent` | string | `"coder"` | Name of the coding entry (mode `all`) |
| `coder_model` | string (optional) | `opencode-go/glm-5.3` | Model for the coder agent |
| `coder_enabled` | boolean | `true` | Whether to register the coder agent |
| `lite_agent` | string | `"lite"` | Name of the economical quick-answer leaf (mode `all`, dispatch denied) |
| `lite_model` | string (optional) | `opencode-go/deepseek-v4.1-flash` | Model for the lite agent |
| `lite_enabled` | boolean | `true` | Whether to register the lite agent |
| `lite_workspace_dir` | string (optional) | `$XDG_DATA_HOME/janus-agent/lite` | lite's pre-approved writable workspace (absolute path) |
| `coder_lite_agent` | string | `"coder-lite"` | Name of the mechanical coding lane (mode `subagent`, leaf node) |
| `coder_lite_model` | string (optional) | `opencode-go/glm-5.3-flash` | Model for the coder-lite lane |
| `coder_lite_enabled` | boolean | `true` | Whether to register the coder-lite lane |
| `build_agent` | string | `"build"` | Target agent name for the `build` dispatch role (the host's native build agent by default) |
| `build_model` | string (optional) | (none — host default) | Model pinned on the `build` role's target agent |
| `build_enabled` | boolean | `true` | Whether the `build` dispatch role accepts work |
| `janus_agent` | string | `"janus"` | Name of the daily-driver primary agent (mode `all`, no memory attachment) |
| `janus_model` | string (optional) | `opencode-go/glm-5.3` | Model for the janus agent |
| `janus_enabled` | boolean | `true` | Whether to register the janus agent |
| `model_prompts` | object (optional) | (none) | Global model-keyed adaptation-prompt map; key = the provider-agnostic normalized model key (provider prefix dropped, lowercased, alphanumerics only), value = the block; an explicit "" disables the block for that model |
| `team_caps.round_cap` | number | `3` | Rounds of explore->critique->synthesize before forced synthesis |
| `team_caps.explorer_cap` | number | `5` | Max parallel explorer instances |
| `team_caps.critic_search_cap` | number | `5` | Max critic verification searches per round |
| `tier_role_caps.*` | object | fast `5/0/0/0/0`, standard `5/1/1/1/1`, deep `5/3/2/2/2` | Advisory maximum instances per role per tier, never minimum calls; `writer` defaults to 0 when a tier omits it |
| `cost_guard_provider_usd` | number | `10` | Advisory stop-loss per provider (converge when approaching) |
| `install_skill` | boolean | `true` | Whether to install the consultation skill into the OpenCode config dir |
| `install_commands` | boolean | `true` | Whether to install the `janus-memory` browse slash command |
| `memory_enabled` | boolean | `true` | Whether to register and launch the memory MCP server |
| `embedding.base_url` | string | (none) | OpenAI-compatible embedding API base URL |
| `embedding.api_key_env` | string | (none) | Name of the env var holding the embedding API key |
| `embedding.model` | string | (none) | Embedding model name |
| `embedding.dimensions` | number | (none) | Embedding vector dimensions |

The `embedding` block is all-or-nothing: set all four sub-fields or omit the block.

Every role has one configured attempt and every agent resolves to a single model, with no plugin fallback advance. A delegate without `writer_delegate_model` uses host model selection (`null` in the durable job spec); it keeps host permissions and host-internal retry behavior. Neither wait expiry nor unknown observation authorizes a backup model.

The consultant routes bounded tasks to its research team: `explorer` gathers missing evidence, `analyst` interprets material disputes, `critic` independently challenges consequential conclusions, `verifier` audits unclear influence or independence of user/third-party/promotional sources, and `writer` produces a blueprint before outline approval or usable section/chapter prose afterward. A potentially relevant check is delegated when its necessity cannot be ruled out; a role is skipped only with a task-specific reason. These roles are not a tier-dependent required roster. Plugin-owned research subagents have `permission.edit = "deny"`, `permission.bash = "deny"`, and `permission.task = "deny"`; an external `writer_delegate_agent` keeps its host-defined permissions and does not inherit these restrictions. Analyst follows evidence, critic follows a draft conclusion, writer's substantive prose follows approved scope and evidence, and the consultant verifies, integrates and writes final files. The default consultant, analyst and critic use different model families; verifier reuses critic's configured model, without a performance guarantee from that choice. Role caps are advisory ceilings rather than a runtime-enforced scheduler.

The consultant may route a bounded quick-answer subtask to `lite` and a bounded code example to `coder`; it does not implement production code itself. Coding is owned by `coder`: fully specified mechanical work goes to `coder-lite` (workspace edits allowed, external edits ask, further dispatch denied — its stop-and-report is a legitimate partial outcome the dispatcher integrates); judgment-heavy work stays with `coder` or goes to the optional `build` host escalation. `coder` selects L0/L1/L2/L3 process weight by task complexity and gates L2/L3 on user approval before editing.

The `janus` agent is the default general entry: it handles general questions and light tasks, and routes consulting to `consultant`, coding to `coder`, quick answers to `lite`, and bulk retrieval to `explorer` — all through the same `janus_dispatch` mechanism. It does not do deep research or heavy coding itself. `consultant` and `coder` are therefore also dispatch roles (targeting their agents by name); `consultant` follows `agent_model`, `coder` follows `coder_model`.

### Model-adaptation prompts

Every plugin-owned agent's prompt assembles in three layers: the role asset
(`assets/agents/<agent>.md` — identity, scope, workflow, discipline) plus a
model-adaptation block plus the runtime bindings. The model block is keyed by
the **model**, not the agent, and matched **provider-agnostically**: swap an
agent's model in config (even to a different provider serving the same model)
and its driving notes follow automatically; a model with no block simply gets
none.

A model id (`provider/model`) is normalized into a single match key by
`normalizeModelKey`:

1. drop the provider prefix — everything up to and including the last `/`
   (`opencode-go/deepseek-v4-pro` → `deepseek-v4-pro`);
2. lowercase the remainder;
3. keep only letters and digits — strip `-`, `.`, spaces, etc.
   (`deepseek-v4-pro` → `deepseekv4pro`).

So `deepseek/deepseek-v4-pro` and `opencode-go/deepseek-v4-pro` both resolve to
`deepseekv4pro` and share one block. Resolution, for that normalized key, is:

1. your `model_prompts` entry for the key wins (an explicit `""` disables the
   block for that model across every provider);
2. else the shipped library block `assets/model-prompts/<key>.md`;
3. else empty — the role asset runs standalone.

Seven blocks ship, each file named by its normalized key: six for the shipped
default models — `glm53.md` (GLM-5.3; default for consultant, janus, and coder),
`deepseekv41flash.md` (DeepSeek V4.1-Flash; default for lite and explorer),
`qwen38max.md` (Qwen3.8-Max; default for analyst), `gemini38flash.md` (Gemini
3.8-Flash; default for critic and verifier), `glm53flash.md` (GLM-5.3-Flash;
default for coder-lite), and `claudesonnet55.md` (Claude Sonnet 5.5; default
for writer) — plus `deepseekflash.md` for the direct-provider id
`deepseek/deepseek-flash` (the same V4.1-Flash model, but a different
normalized key).

To add a block for a model that has none: name the file after the model's
normalized key — the same rule above applied to the model id — drop it at
`assets/model-prompts/<key>.md`, and add the file to `REQUIRED_INSTALLED_FILES`
in `script/install-local.ts` (a fork; installs verify the file). For example a
custom model `acme/deepseek-v4-pro` gets the key `deepseekv4pro` and file
`assets/model-prompts/deepseekv4pro.md`. On an installed plugin you cannot drop
files: point `model_prompts` at your own block text for that key instead.

Block content is model-property only — the model's capability profile,
documented failure tendencies (agentic strength, reasoning/knowledge balance,
calibration, verbosity, long-context steering, protocol precision), and
agent-actionable operating constraints that leverage strengths or control
weaknesses (when to stop, how to verify, how to re-anchor context, how to
control output). Runtime controls — thinking level, reasoning effort,
temperature, max tokens, model selection — are deployment settings, not prompt
content. It carries no role name, role assignment, role rule, price/pool
positioning, or generic output/workflow rule; those live in the agent asset,
because one block drives every agent running that model. The `build` role and delegated writers
target host-owned agents and take no model prompts.

## Data, State, and Cache Paths

The memory SQLite store uses XDG Base Directory paths with environment overrides:

| Path | Default | What lives there |
|------|---------|------------------|
| Data | `$XDG_DATA_HOME/janus-agent/` (default `~/.local/share/janus-agent/`) | `memory.sqlite3` and user-controlled exports |
| State | `$XDG_STATE_HOME/janus-agent/` (default `~/.local/state/janus-agent/`) | Writer lock, pending enrichment state, operational records |
| Cache | `$XDG_CACHE_HOME/janus-agent/` (default `~/.cache/janus-agent/`) | Rebuildable query caches |

The database file defaults to `<dataDir>/memory.sqlite3`. Override with the `JANUS_DATA_DIR`, `JANUS_STATE_DIR`, and `JANUS_CACHE_DIR` environment variables when launching the MCP server.

Canonical experience records (user-approved items, claims, evidence, decisions, preferences, revisions) live in the data directory. Derived artifacts (summaries, embeddings, FTS indexes, tags) are rebuildable and live alongside canonical data but can be deleted and rebuilt without losing accepted experience.

## Step 5: Verify the Install

1. **Entries selectable**: start OpenCode and confirm `janus`, `consultant`, `coder`, and `lite` appear in the agent list.
2. **lite workspace**: `~/.local/share/janus-agent/lite` exists and is the only pre-approved write location.
3. **coder-lite lane registered**: the `coder-lite` agent appears as a subagent (steps 50, workspace-allow edits, task denied).
4. **Memory MCP starts**: the `janus-memory` MCP server is registered. Its five tools (`memory_recall`, `memory_expand`, `memory_prepare`, `memory_commit`, `memory_manage`) are available to the consultant agent.
5. **Research subagents registered**: `consultation-explorer`, `consultation-analyst`, `consultation-critic`, `consultation-verifier`, and `consultation-writer` appear as subagents (mode `subagent`), dispatched by the consultant via the `janus_dispatch` tool.
6. **Skill present**: the skill file exists at `~/.config/opencode/skills/consultation/SKILL.md` (or your `$OPENCODE_CONFIG_DIR/skills/consultation/SKILL.md`).

You can also run the automated integration proof:

```bash
bun run integration
```

This spawns an isolated OpenCode server in a temp sandbox (never touching your real config or DB), loads the plugin, and asserts the agent, MCP, and skill are registered. It prints a PASS/FAIL summary per assertion. If `opencode` is not on PATH, it prints SKIP and exits 0.

By default it loads the packaged `dist/index.js`. To prove an installed bundle — the artifact the deployment rule requires — pass its path:

```bash
JANUS_PLUGIN_ENTRY=~/.local/share/janus-agent-plugin/dist/index.js bun run integration
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
   rm -rf ~/.local/share/janus-agent-plugin
   ```

   Or remove `$JANUS_INSTALL_DIR` if you set one.

3. **Remove the installed skill** (optional):

   ```bash
   rm -rf ~/.config/opencode/skills/consultation
   ```

4. **Remove the plugin config file** (optional):

   ```bash
   rm -f ~/.config/janus-agent/config.jsonc
   ```

   Or if you used `$XDG_CONFIG_HOME`:

   ```bash
   rm -f "$XDG_CONFIG_HOME/janus-agent/config.jsonc"
   ```

5. **Remove the memory data, state, and cache** (optional, this deletes all stored experience):

   ```bash
   rm -rf ~/.local/share/janus-agent
   rm -rf ~/.local/state/janus-agent
   rm -rf ~/.cache/janus-agent
   ```

   Or with custom XDG paths:

   ```bash
   rm -rf "$XDG_DATA_HOME/janus-agent"
   rm -rf "$XDG_STATE_HOME/janus-agent"
   rm -rf "$XDG_CACHE_HOME/janus-agent"
   ```

6. **Remove lite's workspace (optional):** `rm -rf ~/.local/share/janus-agent/lite`.

7. **Restart OpenCode** to confirm the plugin is no longer loaded.
