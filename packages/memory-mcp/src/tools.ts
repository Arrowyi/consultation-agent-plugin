// Tool definitions and dispatch for the 5 memory tools. JSON schemas are
// exposed to the MCP client; zod schemas (from schemas.ts) validate arguments
// inside handlers. Uses the low-level Server setRequestHandler API to avoid
// the zod version mismatch between the project (v3.25.76) and the SDK (v4.1.8).

import { MemoryError } from "@janus-agent/memory-core"
import type {
  CommitInput,
  ExpandInput,
  ManageInput,
  MemoryStore,
  PrepareInput,
  RecallQuery,
} from "@janus-agent/memory-core"
import {
  commitInputSchema,
  expandInputSchema,
  manageInputSchema,
  prepareInputSchema,
  recallInputSchema,
  type ManageArgs,
} from "./schemas.ts"
import { mapError } from "./errors.ts"

const TOOL_NAMES = [
  "memory_recall",
  "memory_expand",
  "memory_prepare",
  "memory_commit",
  "memory_manage",
] as const

export const MEMORY_TOOL_NAMES = TOOL_NAMES

type JsonSchema = {
  readonly type: "object"
  readonly properties?: Record<string, unknown>
  readonly required?: readonly string[]
}

type ToolDefinition = {
  readonly name: string
  readonly description: string
  readonly inputSchema: JsonSchema
}

export const MEMORY_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: "memory_recall",
    description: "Recall relevant memory items by text, taxonomy, or tier (fast/standard/deep).",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        taxonomyNodeId: { type: "string" },
        tier: { type: "string", enum: ["fast", "standard", "deep"] },
        limit: { type: "number" },
        expandTop: { type: "number" },
        tokenBudget: { type: "number" },
        region: { type: "string" },
        timeScope: { type: "string" },
        includeStatuses: { type: "array", items: { type: "string", enum: ["active", "superseded", "refuted", "retired", "forgotten"] } },
      },
      required: ["tier"],
    },
  },
  {
    name: "memory_expand",
    description: "Expand up to 5 memory items to level 3 (full evidence) or level 4 (revisions).",
    inputSchema: {
      type: "object",
      properties: {
        itemIds: { type: "array", items: { type: "string" }, maxItems: 5 },
        level: { type: "integer", enum: [3, 4] },
        tokenBudget: { type: "number" },
      },
      required: ["itemIds", "level"],
    },
  },
  {
    name: "memory_prepare",
    description: "Preview a memory package without persisting anything. Returns previewToken for commit.",
    inputSchema: {
      type: "object",
      properties: {
        hostSessionId: { type: "string" },
        title: { type: "string" },
        items: { type: "array" },
        preferences: { type: "array" },
      },
      required: ["hostSessionId", "title", "items"],
    },
  },
  {
    name: "memory_commit",
    description: "Commit a memory package idempotently using the previewToken from memory_prepare.",
    inputSchema: {
      type: "object",
      properties: {
        hostSessionId: { type: "string" },
        title: { type: "string" },
        items: { type: "array" },
        preferences: { type: "array" },
        previewToken: { type: "string" },
      },
      required: ["hostSessionId", "title", "items", "previewToken"],
    },
  },
  {
    name: "memory_manage",
    description: "Manage memories: retire, forget, forget_session, list/upsert/delete preferences, list sessions, edit an item, record an outcome, or stats.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["retire", "forget", "forget_session", "list_preferences", "upsert_preference", "delete_preference", "list_sessions", "edit_item", "record_outcome", "stats"] },
        itemId: { type: "string" },
        hostSessionId: { type: "string" },
        includeRetired: { type: "boolean" },
        key: { type: "string" },
        value: { type: "string" },
        sensitive: { type: "boolean" },
        confirmed: { type: "boolean" },
        limit: { type: "number" },
        title: { type: "string" },
        oneLineSummary: { type: "string" },
        decisionId: { type: "string" },
        outcomeType: { type: "string", enum: ["satisfied", "dissatisfied", "effective", "ineffective", "neutral"] },
        note: { type: "string" },
        conclusion: { type: "string" },
        reason: { type: "string" },
      },
      required: ["action"],
    },
  },
]

type ToolResult = { content: [{ type: "text"; text: string }]; isError?: boolean }

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] }
}

function parseOrThrow<T>(schema: { safeParse: (data: unknown) => { success: true; data: T } | { success: false; error: { message: string } } }, data: unknown): T {
  const result = schema.safeParse(data)
  if (!result.success) {
    throw new MemoryError("VALIDATION_FAILED", result.error.message)
  }
  return result.data
}

export async function handleToolCall(
  name: string,
  args: unknown,
  store: MemoryStore,
  namespace: string,
): Promise<ToolResult> {
  try {
    switch (name) {
      case "memory_recall": {
        const parsed = parseOrThrow(recallInputSchema, args)
        const query: RecallQuery = { ...parsed, namespace }
        return jsonResult(await store.recall(query))
      }
      case "memory_expand": {
        const parsed = parseOrThrow(expandInputSchema, args)
        const input: ExpandInput = { ...parsed, namespace }
        return jsonResult(await store.expand(input))
      }
      case "memory_prepare": {
        const parsed = parseOrThrow(prepareInputSchema, args)
        const input: PrepareInput = { ...parsed, namespace }
        return jsonResult(await store.prepare(input))
      }
      case "memory_commit": {
        const parsed = parseOrThrow(commitInputSchema, args)
        const input: CommitInput = { ...parsed, namespace }
        return jsonResult(await store.commit(input))
      }
      case "memory_manage": {
        const parsed = parseOrThrow(manageInputSchema, args)
        const input = buildManageInput(parsed, namespace)
        return jsonResult(await store.manage(input))
      }
      default:
        throw new MemoryError("VALIDATION_FAILED", `unknown tool: ${name}`)
    }
  } catch (error) {
    return mapError(error)
  }
}

function buildManageInput(args: ManageArgs, namespace: string): ManageInput {
  switch (args.action) {
    case "retire":
      return { action: "retire", namespace, itemId: requireField(args.itemId, "itemId") }
    case "forget":
      return { action: "forget", namespace, itemId: requireField(args.itemId, "itemId") }
    case "forget_session":
      return { action: "forget_session", namespace, hostSessionId: requireField(args.hostSessionId, "hostSessionId") }
    case "list_preferences":
      return { action: "list_preferences", namespace, ...(args.includeRetired !== undefined ? { includeRetired: args.includeRetired } : {}) }
    case "upsert_preference":
      return {
        action: "upsert_preference",
        namespace,
        key: requireField(args.key, "key"),
        value: requireField(args.value, "value"),
        sensitive: requireField(args.sensitive, "sensitive"),
        confirmed: requireField(args.confirmed, "confirmed"),
      }
    case "delete_preference":
      return { action: "delete_preference", namespace, key: requireField(args.key, "key") }
    case "list_sessions":
      return { action: "list_sessions", namespace, ...(args.limit !== undefined ? { limit: args.limit } : {}) }
    case "edit_item":
      return {
        action: "edit_item",
        namespace,
        itemId: requireField(args.itemId, "itemId"),
        ...(args.title !== undefined ? { title: args.title } : {}),
        ...(args.oneLineSummary !== undefined ? { oneLineSummary: args.oneLineSummary } : {}),
        ...(args.conclusion !== undefined ? { conclusion: args.conclusion } : {}),
        ...(args.reason !== undefined ? { reason: args.reason } : {}),
      }
    case "record_outcome":
      return {
        action: "record_outcome",
        namespace,
        itemId: requireField(args.itemId, "itemId"),
        ...(args.decisionId !== undefined ? { decisionId: args.decisionId } : {}),
        outcomeType: requireField(args.outcomeType, "outcomeType"),
        ...(args.note !== undefined ? { note: args.note } : {}),
      }
    case "stats":
      return { action: "stats", namespace }
  }
}

function requireField<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new MemoryError("VALIDATION_FAILED", `missing required field: ${name}`)
  return value
}
