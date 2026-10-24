// Build OpenStoreOptions from JANUS_* env vars and open a MemoryStore.
// Embedding provider is created ONLY when all 4 embedding env vars are set.

import type { MemoryStore } from "@janus-agent/memory-core"
import {
  createOpenAICompatibleEmbeddingProvider,
  openMemoryStore,
  type EmbeddingProvider,
  type OpenStoreOptions,
} from "@janus-agent/memory-sqlite"

export function storeOptionsFromEnv(env: NodeJS.ProcessEnv): OpenStoreOptions {
  const dataDir = nonEmpty(env.JANUS_DATA_DIR)
  const stateDir = nonEmpty(env.JANUS_STATE_DIR)
  const cacheDir = nonEmpty(env.JANUS_CACHE_DIR)
  const embedding = embeddingFromEnv(env)
  return {
    ...(dataDir === undefined ? {} : { dataDir }),
    ...(stateDir === undefined ? {} : { stateDir }),
    ...(cacheDir === undefined ? {} : { cacheDir }),
    ...(embedding === undefined ? {} : { embedding }),
  }
}

export async function openStoreFromEnv(env: NodeJS.ProcessEnv): Promise<MemoryStore> {
  return openMemoryStore(storeOptionsFromEnv(env))
}

function embeddingFromEnv(env: NodeJS.ProcessEnv): EmbeddingProvider | undefined {
  const baseUrl = nonEmpty(env.JANUS_EMBEDDING_BASE_URL)
  const model = nonEmpty(env.JANUS_EMBEDDING_MODEL)
  const apiKeyEnv = nonEmpty(env.JANUS_EMBEDDING_API_KEY_ENV)
  const dimensionsStr = nonEmpty(env.JANUS_EMBEDDING_DIMENSIONS)
  if (baseUrl === undefined || model === undefined || apiKeyEnv === undefined || dimensionsStr === undefined) {
    return undefined
  }
  const dimensions = Number.parseInt(dimensionsStr, 10)
  if (!Number.isFinite(dimensions) || dimensions <= 0) return undefined
  return createOpenAICompatibleEmbeddingProvider({ baseUrl, model, apiKeyEnv, dimensions })
}

function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) return undefined
  return value
}
