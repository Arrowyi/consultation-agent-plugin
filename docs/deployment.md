# Local Deployment Guide

This guide covers installing the consultation-agent plugin into a local OpenCode setup. No build step is required for local use; Bun runs the TypeScript source directly.

## Prerequisites

- **Bun >= 1.1** - the runtime and package manager. Install from <https://bun.sh>.
- **OpenCode** - the agent harness. Install from <https://opencode.ai> or your package manager. Verify with `opencode --version`.

Both must be on your `PATH`.

## Step 1: Install Dependencies

Clone this repository and install its dependencies. Bun is the only package manager; never use npm, yarn, or pnpm.

```bash
git clone <repo-url> consultation-agent-plugin
cd consultation-agent-plugin
bun install
```

## Step 2: Add the Plugin to OpenCode

OpenCode loads plugins declared in its config file. Edit `~/.config/opencode/opencode.json` (create it if missing) and add a `plugin` array entry pointing at the adapter.

### Source Mode (recommended for local development)

Point the `file://` entry at the adapter's TypeScript source. Bun runs it directly, no build needed.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "file:///absolute/path/to/consultation-agent-plugin/packages/opencode-adapter/src/index.ts"
  ]
}
```

Replace `absolute/path/to` with the real absolute path to your clone. For example, if you cloned into `/home/me/consultation-agent-plugin`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "file:///home/me/consultation-agent-plugin/packages/opencode-adapter/src/index.ts"
  ]
}
```

### Dist Mode (for a bundled install)

If you prefer a bundled artifact, run `bun run build` first, then point the entry at `dist/index.js`:

```bash
bun run build
```

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "file:///absolute/path/to/consultation-agent-plugin/dist/index.js"
  ]
}
```

The build script bundles two entrypoints into `dist/`:
- `dist/index.js` - the OpenCode adapter plugin
- `dist/memory-mcp-server.js` - the memory MCP server (bundled when `packages/memory-mcp/src/server.ts` exists)

## Step 3: Restart OpenCode

Restart OpenCode so it picks up the new plugin entry. On startup the plugin's `config` hook runs and:
1. registers the `consultant` primary agent;
2. registers the four team subagents `consultation-explorer`, `consultation-analyst`, `consultation-critic`, `consultation-verifier` (each read-only, each on its own model);
3. registers the `consultation-memory` local MCP server (when memory is enabled, the default);
4. registers the `consultation_dispatch` tool, which the consultant uses to dispatch to the four team subagents (it handles only these four and does not interfere with the built-in `task` tool or other plugins);
5. installs the `consultation` skill and the `consultation-memory` browse command into your OpenCode config directory.

## Step 4: Optional Plugin Configuration

The plugin reads an optional JSONC config file. Default locations (first found wins):

1. `$CONSULTATION_CONFIG` - explicit path override
2. `$XDG_CONFIG_HOME/consultation-agent/config.jsonc`
3. `~/.config/consultation-agent/config.jsonc`

A missing file is fine; all fields have defaults. Create the file to override defaults:

```jsonc
{
  // Models for the consultant and its four team subagents. All are optional;
  // the defaults below ship with the plugin and are tuned for cross-model
  // verification (consultant vs analyst vs critic vs verifier use different families).
  "agent_model": "deepseek/deepseek-v4-pro",
  "explorer_model": "deepseek/deepseek-v4-flash",
  "analyst_model": "opencode-go/qwen3.7-max",
  "critic_model": "opencode-go/glm-5.2",
  "verifier_model": "opencode-go/qwen3.7-max",

  // Subagent names. Rename only if they clash with an existing agent.
  "explorer_agent": "consultation-explorer",
  "analyst_agent": "consultation-analyst",
  "critic_agent": "consultation-critic",
  "verifier_agent": "consultation-verifier",

  // Whether to register the critic and verifier subagents. Default true.
  "critic_enabled": true,
  "verifier_enabled": true,

  // Team loop and fan-out caps. All optional; defaults shown.
  "team_caps": {
    "round_cap": 3,          // explore->critique->synthesize rounds
    "explorer_cap": 5,       // max parallel explorers
    "critic_search_cap": 5   // max critic verification searches per round
  },

  // Max instances per role per tier (explorer/analyst/critic/verifier). All optional; defaults shown.
  "tier_role_caps": {
    "fast":     { "explorer": 5, "analyst": 0, "critic": 0, "verifier": 0 },
    "standard": { "explorer": 5, "analyst": 1, "critic": 1, "verifier": 1 },
    "deep":     { "explorer": 5, "analyst": 3, "critic": 2, "verifier": 2 }
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
| `agent_model` | string (optional) | `deepseek/deepseek-v4-pro` | Model for the `consultant` agent |
| `explorer_agent` | string | `"consultation-explorer"` | Name of the search/gathering subagent |
| `explorer_model` | string (optional) | `deepseek/deepseek-v4-flash` | Model for the explorer subagent |
| `analyst_agent` | string | `"consultation-analyst"` | Name of the analysis subagent |
| `analyst_model` | string (optional) | `opencode-go/qwen3.7-max` | Model for the analyst subagent |
| `critic_agent` | string | `"consultation-critic"` | Name of the adversarial critic subagent |
| `critic_model` | string (optional) | `opencode-go/glm-5.2` | Model for the critic subagent |
| `critic_enabled` | boolean | `true` | Whether to register the critic subagent |
| `verifier_agent` | string | `"consultation-verifier"` | Name of the intent-audit subagent |
| `verifier_model` | string (optional) | `opencode-go/qwen3.7-max` | Model for the verifier subagent |
| `verifier_enabled` | boolean | `true` | Whether to register the verifier subagent |
| `team_caps.round_cap` | number | `3` | Rounds of explore->critique->synthesize before forced synthesis |
| `team_caps.explorer_cap` | number | `5` | Max parallel explorer instances |
| `team_caps.critic_search_cap` | number | `5` | Max critic verification searches per round |
| `tier_role_caps.*` | object | fast `5/0/0/0`, standard `5/1/1/1`, deep `5/3/2/2` | Max instances per role per tier (explorer/analyst/critic/verifier) |
| `cost_guard_provider_usd` | number | `10` | Advisory stop-loss per provider (converge when approaching) |
| `install_skill` | boolean | `true` | Whether to install the consultation skill into the OpenCode config dir |
| `install_commands` | boolean | `true` | Whether to install the `consultation-memory` browse slash command |
| `memory_enabled` | boolean | `true` | Whether to register and launch the memory MCP server |
| `embedding.base_url` | string | (none) | OpenAI-compatible embedding API base URL |
| `embedding.api_key_env` | string | (none) | Name of the env var holding the embedding API key |
| `embedding.model` | string | (none) | Embedding model name |
| `embedding.dimensions` | number | (none) | Embedding vector dimensions |

The `embedding` block is all-or-nothing: set all four sub-fields or omit the block.

The consultant leads a team of four read-only subagents, all `permission.edit = "deny"`: `explorer` (gather evidence, fan-out up to 5 instances), `analyst` (independent cross-model reasoning), `critic` (adversarial counter-evidence), and `verifier` (deliberate-deception intent audit). They run the loop `explore -> analyze -> critique`, bounded by a 3-round cap; in select and verify modes the verifier audits user-generated sources for astroturfing alongside. Each role runs on its own model by default so the analysis, critique, and intent audit are cross-model, not the consultant arguing with itself.

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
2. **Memory MCP starts**: the `consultation-memory` MCP server is registered. Its five tools (`memory_recall`, `memory_expand`, `memory_prepare`, `memory_commit`, `memory_manage`) are available to the consultant agent.
3. **Team subagents registered**: `consultation-explorer`, `consultation-analyst`, and `consultation-critic` appear as subagents (mode `subagent`), dispatched by the consultant via the `task` tool.
4. **Skill present**: the skill file exists at `~/.config/opencode/skills/consultation/SKILL.md` (or your `$OPENCODE_CONFIG_DIR/skills/consultation/SKILL.md`).

You can also run the automated integration proof:

```bash
bun run integration
```

This spawns an isolated OpenCode server in a temp sandbox (never touching your real config or DB), loads the plugin, and asserts the agent, MCP, and skill are registered. It prints a PASS/FAIL summary per assertion. If `opencode` is not on PATH, it prints SKIP and exits 0.

## Running Tests, Typecheck, and Build

```bash
bun test                     # all unit tests (co-located *.test.ts, bun:test)
bun run typecheck            # tsc --noEmit across the workspace
bun run build                # bundle adapter + memory-mcp into dist/
bun run evals/run-evals.ts   # print the evaluation checklist (no live model calls)
```

The evaluation fixtures under `evals/fixtures/` encode the architecture verification scenarios. Deterministic cases map to package unit tests; model-graded cases print a reviewer rubric. See [evals/README.md](../evals/README.md) for details.

## Uninstall

1. **Remove the plugin entry** from your OpenCode config. Edit `~/.config/opencode/opencode.json` and remove the `file://` entry from the `plugin` array.

2. **Remove the installed skill** (optional):

   ```bash
   rm -rf ~/.config/opencode/skills/consultation
   ```

3. **Remove the plugin config file** (optional):

   ```bash
   rm -f ~/.config/consultation-agent/config.jsonc
   ```

   Or if you used `$XDG_CONFIG_HOME`:

   ```bash
   rm -f "$XDG_CONFIG_HOME/consultation-agent/config.jsonc"
   ```

4. **Remove the memory data, state, and cache** (optional, this deletes all stored experience):

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

5. **Restart OpenCode** to confirm the plugin is no longer loaded.
