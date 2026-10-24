# Maintainer Guide

## Deployment rule (non-negotiable)

This plugin ships to other users, so a deployment must be reproducible from build artifacts alone — never from this checkout.

- Build and install with `bun run install:local`: it builds `dist/`, stages `dist/` + `assets/` into the install prefix (`~/.local/share/janus-agent-plugin` by default), and verifies the result.
- Point OpenCode's `plugin` entry at the **installed** `dist/index.js`; never at `packages/opencode-adapter/src/index.ts`.
- Keep the bundle self-contained. `script/build.ts` marks nothing external and the memory MCP server resolves to the bundled `memory-mcp-server.js` sibling, so no `node_modules` ships with an install. An external runtime import breaks packaged installs.
- Source-mode entries are for this repo's own test runs only, never for a working setup or a release.

Full detail: [docs/deployment.md](docs/deployment.md#deployment-rule).

## Change checklist

1. Edit source under `packages/` (and `script/`); never edit the generated `dist/` or the install prefix by hand.
2. Run `bun test` and `bun run typecheck`.
3. Run `bun run install:local`, then prove the installed artifact:
   `JANUS_PLUGIN_ENTRY=~/.local/share/janus-agent-plugin/dist/index.js bun run integration`.
4. Restart OpenCode so it loads the new bundle (the `config` hook re-registers agents, the memory MCP, the skill, and the command).

Role model defaults live in `packages/opencode-adapter/src/plugin-config.ts` (`MODEL_DEFAULTS`) and are mirrored in `docs/deployment.md`; update both, plus the assertions in `plugin.test.ts`, `agent-registration.test.ts`, and `dispatch-tool.test.ts`.

The current role family is `janus` (default general entry), `consultant` (evidence entry), `coder` (coding entry), `lite` (economical leaf), the five research subagents, and `coder-lite`; `build` is an optional host delegation target. Update the role assets, registration, dispatch roles, install list, and docs together when changing the family.
