// Optional embedding provider. When null, recall skips semantic scoring and
// relies on taxonomy + FTS. createOpenAICompatibleEmbeddingProvider posts to an
// OpenAI-wire-format /embeddings endpoint, reading the api key from the env var
// NAMED by apiKeyEnv at call time.

import { MemoryError } from "@consultation-agent/memory-core"

export interface EmbeddingProvider {
  readonly id: string
  readonly dimensions: number
  embed(texts: readonly string[]): Promise<readonly (readonly number[])[]>
}

export type EmbeddingProviderConfig = {
  readonly baseUrl: string
  readonly apiKeyEnv: string
  readonly model: string
  readonly dimensions: number
}

export function createOpenAICompatibleEmbeddingProvider(config: EmbeddingProviderConfig): EmbeddingProvider {
  return {
    id: config.model,
    dimensions: config.dimensions,
    async embed(texts) {
      const key = process.env[config.apiKeyEnv]
      if (key === undefined || key.length === 0) {
        throw new MemoryError("VALIDATION_FAILED", `embedding api key env var ${config.apiKeyEnv} is not set`)
      }
      const endpoint = `${config.baseUrl.replace(/\/$/, "")}/embeddings`
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ model: config.model, input: [...texts] }),
      })
      if (!response.ok) {
        throw new MemoryError("VALIDATION_FAILED", `embedding request failed: ${response.status} ${response.statusText}`)
      }
      const payload: unknown = await response.json()
      if (!isEmbeddingResponse(payload)) {
        throw new MemoryError("VALIDATION_FAILED", "invalid embedding response shape")
      }
      return payload.data.map((entry) => entry.embedding)
    },
  }
}

type EmbeddingResponse = { readonly data: readonly { readonly embedding: readonly number[] }[] }

function isEmbeddingResponse(value: unknown): value is EmbeddingResponse {
  if (typeof value !== "object" || value === null || !("data" in value)) return false
  const data = (value as { data: unknown }).data
  if (!Array.isArray(data)) return false
  return data.every((entry) => {
    if (typeof entry !== "object" || entry === null || !("embedding" in entry)) return false
    const embedding = (entry as { embedding: unknown }).embedding
    return Array.isArray(embedding) && embedding.every((n: unknown) => typeof n === "number")
  })
}

// Cosine similarity over Float32Array vectors serialized to BLOB.
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0
  let normA = 0
  let normB = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    dot += av * bv
    normA += av * av
    normB += bv * bv
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export function float32ArrayToBlob(vector: readonly number[]): Uint8Array {
  const buffer = new Float32Array(vector)
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
}

export function blobToFloat32Array(blob: Uint8Array, dimensions: number): Float32Array {
  const view = new Float32Array(blob.buffer, blob.byteOffset, dimensions)
  return new Float32Array(view)
}
