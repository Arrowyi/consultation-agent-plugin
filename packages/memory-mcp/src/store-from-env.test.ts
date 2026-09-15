import { describe, expect, test } from "bun:test"
import { storeOptionsFromEnv } from "./store-from-env.ts"

describe("storeOptionsFromEnv", () => {
  test("passes through data/state/cache dirs when set", () => {
    // given
    const env = {
      CONSULTATION_DATA_DIR: "/tmp/data",
      CONSULTATION_STATE_DIR: "/tmp/state",
      CONSULTATION_CACHE_DIR: "/tmp/cache",
    }

    // when
    const options = storeOptionsFromEnv(env)

    // then
    expect(options.dataDir).toBe("/tmp/data")
    expect(options.stateDir).toBe("/tmp/state")
    expect(options.cacheDir).toBe("/tmp/cache")
  })

  test("leaves dirs undefined when env vars are absent", () => {
    // given
    const env: NodeJS.ProcessEnv = {}

    // when
    const options = storeOptionsFromEnv(env)

    // then
    expect(options.dataDir).toBeUndefined()
    expect(options.stateDir).toBeUndefined()
    expect(options.cacheDir).toBeUndefined()
  })

  test("treats empty-string env vars as unset", () => {
    // given
    const env = { CONSULTATION_DATA_DIR: "", CONSULTATION_STATE_DIR: "", CONSULTATION_CACHE_DIR: "" }

    // when
    const options = storeOptionsFromEnv(env)

    // then
    expect(options.dataDir).toBeUndefined()
    expect(options.stateDir).toBeUndefined()
    expect(options.cacheDir).toBeUndefined()
  })

  test("creates embedding provider when all 4 embedding env vars are set", () => {
    // given
    const env = {
      CONSULTATION_EMBEDDING_BASE_URL: "https://api.example.com/v1",
      CONSULTATION_EMBEDDING_MODEL: "text-embedding-3-small",
      CONSULTATION_EMBEDDING_API_KEY_ENV: "OPENAI_API_KEY",
      CONSULTATION_EMBEDDING_DIMENSIONS: "1536",
    }

    // when
    const options = storeOptionsFromEnv(env)

    // then
    expect(options.embedding).not.toBeNull()
    expect(options.embedding?.id).toBe("text-embedding-3-small")
    expect(options.embedding?.dimensions).toBe(1536)
  })

  test("leaves embedding null when any of the 4 env vars is missing", () => {
    // given
    const env = {
      CONSULTATION_EMBEDDING_BASE_URL: "https://api.example.com/v1",
      CONSULTATION_EMBEDDING_MODEL: "text-embedding-3-small",
      CONSULTATION_EMBEDDING_API_KEY_ENV: "OPENAI_API_KEY",
    }

    // when
    const options = storeOptionsFromEnv(env)

    // then
    expect(options.embedding).toBeUndefined()
  })

  test("leaves embedding null when dimensions is not a positive integer", () => {
    // given
    const env = {
      CONSULTATION_EMBEDDING_BASE_URL: "https://api.example.com/v1",
      CONSULTATION_EMBEDDING_MODEL: "text-embedding-3-small",
      CONSULTATION_EMBEDDING_API_KEY_ENV: "OPENAI_API_KEY",
      CONSULTATION_EMBEDDING_DIMENSIONS: "not-a-number",
    }

    // when
    const options = storeOptionsFromEnv(env)

    // then
    expect(options.embedding).toBeUndefined()
  })
})
