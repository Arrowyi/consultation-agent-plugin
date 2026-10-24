/**
 * Clean-room environment builder for the OpenCode integration proof.
 *
 * Produces a child-process environment that isolates HOME / XDG paths and
 * scrubs developer-local configuration overrides and external skill sources.
 * The explicit `plugin` entry in the generated opencode.json remains the only
 * way the plugin is loaded; `OPENCODE_PURE` is intentionally avoided.
 */

export type SandboxPaths = {
  readonly home: string
  readonly xdgConfigHome: string
  readonly xdgDataHome: string
  readonly xdgStateHome: string
  readonly xdgCacheHome: string
}

/**
 * Environment keys that can bridge back to the developer machine and must be
 * removed before spawning the OpenCode server under test.
 */
export const CLEANROOM_BLOCKED_KEYS = [
  "JANUS_CONFIG",
  "OPENCODE_CONFIG",
  "OPENCODE_CONFIG_CONTENT",
  "OPENCODE_CONFIG_DIR",
  "OPENCODE_PURE",
  "OPENCODE_DISABLE_DEFAULT_PLUGINS",
  "OPENCODE_DISABLE_PROJECT_CONFIG",
] as const

/**
 * Build a sanitized environment for the OpenCode child process.
 *
 * - Sandboxes HOME and XDG_* to the supplied paths.
 * - Disables autoupdate, model fetching, and external skill loading.
 * - Removes any parent env keys that point to developer-local config.
 * - Preserves everything else, including `JANUS_PLUGIN_ENTRY`.
 */
export function buildCleanRoomEnv(
  parent: NodeJS.ProcessEnv,
  sandbox: SandboxPaths,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...parent }

  env.HOME = sandbox.home
  env.XDG_CONFIG_HOME = sandbox.xdgConfigHome
  env.XDG_DATA_HOME = sandbox.xdgDataHome
  env.XDG_STATE_HOME = sandbox.xdgStateHome
  env.XDG_CACHE_HOME = sandbox.xdgCacheHome

  env.OPENCODE_DISABLE_AUTOUPDATE = "1"
  env.OPENCODE_DISABLE_MODELS_FETCH = "1"
  env.OPENCODE_DISABLE_EXTERNAL_SKILLS = "1"
  env.OPENCODE_DISABLE_CLAUDE_CODE_SKILLS = "1"

  for (const key of CLEANROOM_BLOCKED_KEYS) {
    delete env[key]
  }

  return env
}
