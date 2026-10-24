import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { resolveOpencodeConfigDir } from "./skill-installer.ts"

/**
 * The unified prefix for the memory-browse slash command, matching the CLI
 * binary and the MCP server name so all three surfaces share one name.
 */
export const MEMORY_COMMAND_PREFIX = "janus-memory"

const USER_MODIFIED_MARKER = "<!-- user-modified -->"

function commandContent(): string {
  return `---
description: Browse and manage your saved consultations — list them, view one, or delete/forget one or many at once.
---

Help the user browse and manage their saved consultations using the janus-memory MCP tools (memory_recall / memory_expand / memory_manage). Do NOT run the janus-memory CLI here: the MCP tools already own this workflow.

1. List them: call \`memory_recall\` with \`tier: "standard"\`, \`limit: 50\`, and \`expandTop: 50\` so each consultation's current conclusion is included. Present the result as a numbered list, ONE line per consultation — the question summary (title), a short conclusion, and the date. Keep it compact. If it is empty, say there are no saved consultations yet and suggest asking the consultant a question first.

2. Then show exactly this operation hint:

操作提示：
- 查看详情：回复序号（如 "1"）
- 删除（可恢复）：回复 "删 2"，或批量 "删 2，4，5"、"删 4~9"
- 永久删除：回复 "忘 …"（同样支持单个、多个、区间）
- 只保留：回复 "留 5，7"（删除其余全部，可恢复）

3. Map each number to that entry's \`itemId\`. Parse the user's reply into target positions:
   - a bare number N → VIEW only: call \`memory_expand\` with \`itemIds: ["<itemId of #N>"]\` and \`level: 3\`, then present the full consultation (question, conclusion, confidence, stability, key sources). No confirmation needed.
   - otherwise it is a delete/forget/keep command. Resolve the position set:
     - single: "2" → {2}
     - list: "2，4，5" (accept "," "、" and spaces) → {2,4,5}
     - range: "4~9", "4-9", "4 到 9" → every integer from 4 to 9 inclusive
     - keep-only ("留" / "只保留" N…): the targets are ALL positions EXCEPT the listed ones
     - a mix like "2，4~6，8" is allowed — union all the parts
   Map every resolved position to its \`itemId\`. "删" and "留" mean \`action: "retire"\`; "忘" means \`action: "forget"\`.

4. For any delete/forget/keep command (especially a batch), FIRST show the user exactly which consultations will be affected (their numbers and titles) plus the total count, and ask them to confirm. Only after they confirm, call \`memory_manage\` once per target \`itemId\`, then report the result (e.g., "已删除 5 条：<titles>"). If a position is out of range, say so and do nothing until they give valid ones.

This lists consultations for the current project (memory is per-project). For a cross-project global list, run the janus-memory CLI when OpenCode is not running.
`
}

/**
 * Install the memory-browse slash command into the opencode config directory.
 * Writes `<configDir>/commands/janus-memory.md` with the resolved CLI
 * path baked in. Written only when missing or when the content differs; a file
 * whose first line is `<!-- user-modified -->` is never overwritten.
 */
export async function installMemoryCommands(env: NodeJS.ProcessEnv): Promise<void> {
  const configDir = resolveOpencodeConfigDir(env)
  const targetDir = join(configDir, "commands")
  const targetFile = join(targetDir, `${MEMORY_COMMAND_PREFIX}.md`)
  const content = commandContent()

  let existing: string | undefined
  try {
    existing = await readFile(targetFile, "utf8")
  } catch {
    // missing file — proceed to write
  }
  if (existing !== undefined) {
    if (existing.startsWith(USER_MODIFIED_MARKER)) return
    if (existing === content) return
  }

  await mkdir(targetDir, { recursive: true })
  const tmpFile = `${targetFile}.tmp`
  await writeFile(tmpFile, content, "utf8")
  await rename(tmpFile, targetFile)
}
