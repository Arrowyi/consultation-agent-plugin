#!/usr/bin/env bun
// consultation-memory-mcp entry point. Boots the stdio MCP server when run
// directly. All logs go to stderr; stdout is reserved for protocol frames.

import { startMemoryMcpServer } from "./mcp-server.ts"

async function main(): Promise<void> {
  const handle = await startMemoryMcpServer()
  const shutdown = (): void => {
    void handle.close().finally(() => process.exit(0))
  }
  process.on("SIGTERM", shutdown)
  process.on("SIGINT", shutdown)
}

if (import.meta.main) {
  void main()
}
