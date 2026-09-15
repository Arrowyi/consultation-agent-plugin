// XDG Base Directory resolution with the consultation-agent suffix.
// An empty XDG var is treated as unset (per the XDG spec).

import { homedir } from "node:os"
import { join } from "node:path"

export type StoragePaths = { readonly dataDir: string; readonly stateDir: string; readonly cacheDir: string }

function xdgOr(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const value = env[key]
  if (value !== undefined && value.length > 0) return value
  return fallback
}

export function resolveStoragePaths(env: NodeJS.ProcessEnv = process.env): StoragePaths {
  const home = (env.HOME !== undefined && env.HOME.length > 0 ? env.HOME : homedir()) || "/tmp"
  return {
    dataDir: join(xdgOr(env, "XDG_DATA_HOME", join(home, ".local", "share")), "consultation-agent"),
    stateDir: join(xdgOr(env, "XDG_STATE_HOME", join(home, ".local", "state")), "consultation-agent"),
    cacheDir: join(xdgOr(env, "XDG_CACHE_HOME", join(home, ".cache")), "consultation-agent"),
  }
}
