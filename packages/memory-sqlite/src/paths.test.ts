import { describe, expect, test } from "bun:test"
import { resolveStoragePaths } from "./paths.ts"

describe("resolveStoragePaths", () => {
  test("uses XDG env vars when set and appends the consultation-agent suffix", () => {
    // given
    const env = {
      XDG_DATA_HOME: "/custom/data",
      XDG_STATE_HOME: "/custom/state",
      XDG_CACHE_HOME: "/custom/cache",
      HOME: "/home/user",
    }
    // when
    const paths = resolveStoragePaths(env)
    // then
    expect(paths.dataDir).toBe("/custom/data/consultation-agent")
    expect(paths.stateDir).toBe("/custom/state/consultation-agent")
    expect(paths.cacheDir).toBe("/custom/cache/consultation-agent")
  })

  test("falls back to ~/.local/share, ~/.local/state, ~/.cache under HOME when XDG vars are absent", () => {
    // given
    const env = { HOME: "/home/user" }
    // when
    const paths = resolveStoragePaths(env)
    // then
    expect(paths.dataDir).toBe("/home/user/.local/share/consultation-agent")
    expect(paths.stateDir).toBe("/home/user/.local/state/consultation-agent")
    expect(paths.cacheDir).toBe("/home/user/.cache/consultation-agent")
  })

  test("treats an empty XDG var as unset and falls back to the default", () => {
    // given
    const env = { XDG_DATA_HOME: "", HOME: "/home/user" }
    // when
    const paths = resolveStoragePaths(env)
    // then
    expect(paths.dataDir).toBe("/home/user/.local/share/consultation-agent")
  })
})
