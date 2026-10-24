import { describe, expect, test } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { MemoryError } from "@janus-agent/memory-core"
import type {
  CommitInput,
  CommitResult,
  ExpandInput,
  ExpandResult,
  ManageInput,
  ManageResult,
  MemoryStore,
  PrepareInput,
  PrepareResult,
  RecallQuery,
  RecallResult,
} from "@janus-agent/memory-core"
import { createMemoryMcpServer } from "./mcp-server.ts"

async function writerLocked(): Promise<never> {
  throw new MemoryError("WRITER_LOCKED", "another process owns the database")
}

const lockedStore: MemoryStore = {
  prepare: (_input: PrepareInput): Promise<PrepareResult> => writerLocked(),
  commit: (_input: CommitInput): Promise<CommitResult> => writerLocked(),
  recall: (_query: RecallQuery): Promise<RecallResult> => writerLocked(),
  expand: (_input: ExpandInput): Promise<ExpandResult> => writerLocked(),
  manage: (_input: ManageInput): Promise<ManageResult> => writerLocked(),
  close: async (): Promise<void> => {},
}

describe("memory MCP errors", () => {
  test("returns a MemoryError payload when recall encounters a writer lock", async () => {
    // given
    const server = createMemoryMcpServer(lockedStore, "test")
    const client = new Client({ name: "memory-mcp-test", version: "0.1.0" })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([client.connect(clientTransport), server.server.connect(serverTransport)])

    // when
    const result = await client.callTool({
      name: "memory_recall",
      arguments: { tier: "standard" },
    })

    // then
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([
      {
        type: "text",
        text: JSON.stringify({
          code: "WRITER_LOCKED",
          message: "WRITER_LOCKED: another process owns the database",
        }),
      },
    ])
    await client.close()
    await server.close()
  })
})
