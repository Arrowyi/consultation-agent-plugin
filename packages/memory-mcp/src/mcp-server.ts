// Memory MCP server factory. createMemoryMcpServer builds a low-level SDK
// Server with the 5 memory tools registered (transport-agnostic, testable via
// InMemoryTransport). startMemoryMcpServer is the public entry: resolves env,
// opens a store when none is injected, and connects a StdioServerTransport.
// The low-level Server API is used so the project's zod v3 schemas never touch
// the SDK's bundled zod v4 types.

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import type { MemoryStore } from "@consultation-agent/memory-core"
import { MEMORY_TOOL_DEFINITIONS, handleToolCall } from "./tools.ts"
import { openStoreFromEnv } from "./store-from-env.ts"

const SERVER_NAME = "consultation-memory"
const SERVER_VERSION = "0.1.0"
const DEFAULT_NAMESPACE = "default"

export type StartMcpServerOptions = {
  readonly store?: MemoryStore
  readonly env?: NodeJS.ProcessEnv
}

export type MemoryMcpServer = {
  readonly server: Server
  readonly close: () => Promise<void>
}

export type McpServerHandle = {
  readonly close: () => Promise<void>
}

type SdkTool = {
  readonly name: string
  readonly description: string
  readonly inputSchema: {
    readonly type: "object"
    readonly properties?: Record<string, unknown>
    readonly required?: string[]
  }
}

function toSdkTools(): SdkTool[] {
  return MEMORY_TOOL_DEFINITIONS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: {
      type: "object",
      ...(tool.inputSchema.properties === undefined ? {} : { properties: tool.inputSchema.properties }),
      ...(tool.inputSchema.required === undefined ? {} : { required: [...tool.inputSchema.required] }),
    },
  }))
}

export function createMemoryMcpServer(store: MemoryStore, namespace: string): MemoryMcpServer {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  )
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toSdkTools() }))
  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    handleToolCall(request.params.name, request.params.arguments, store, namespace),
  )
  return {
    server,
    close: async () => {
      await server.close()
    },
  }
}

export async function startMemoryMcpServer(options: StartMcpServerOptions = {}): Promise<McpServerHandle> {
  const env = options.env ?? process.env
  const namespace = resolveNamespace(env)
  const store = options.store ?? (await openStoreFromEnv(env))
  const ownsStore = options.store === undefined
  const { server, close } = createMemoryMcpServer(store, namespace)
  const transport = new StdioServerTransport()
  await server.connect(transport)
  return {
    async close() {
      await close()
      if (ownsStore) await store.close()
    },
  }
}

export function resolveNamespace(env: NodeJS.ProcessEnv): string {
  const ns = env.CONSULTATION_NAMESPACE
  if (ns !== undefined && ns.length > 0) return ns
  return DEFAULT_NAMESPACE
}
