#!/usr/bin/env bun
// Build script: bundles the OpenCode adapter and the memory MCP server into dist/.
//
// Run: bun run build  (wired in root package.json as "build": "bun run script/build.ts")
//
// Entrypoints:
//   packages/opencode-adapter/src/index.ts -> dist/index.js
//   packages/memory-mcp/src/server.ts     -> dist/memory-mcp-server.js (optional)
//
// The memory-mcp entry is optional: if its source file does not exist yet, the
// script prints a warning and continues, so the script is correct both before
// and after the memory-mcp package is implemented.

import { existsSync, renameSync, statSync } from "node:fs"
import { join } from "node:path"

const REPO_ROOT = join(import.meta.dir, "..")
const DIST_DIR = join(REPO_ROOT, "dist")
// Installed artifacts ship without node_modules, so keep this empty:
// an external import here breaks a packaged install (docs/deployment.md).
const EXTERNAL: string[] = []

interface BuildJob {
  readonly entrypoint: string
  readonly outfile: string
  readonly required: boolean
  readonly naming?: string
}

const jobs: BuildJob[] = [
  {
    entrypoint: join(REPO_ROOT, "packages/opencode-adapter/src/index.ts"),
    outfile: join(DIST_DIR, "index.js"),
    required: true,
  },
  {
    entrypoint: join(REPO_ROOT, "packages/memory-mcp/src/server.ts"),
    outfile: join(DIST_DIR, "memory-mcp-server.js"),
    required: false,
    naming: "memory-mcp-server.js",
  },
]

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`
}

async function runJob(job: BuildJob): Promise<boolean> {
  if (!existsSync(job.entrypoint)) {
    if (job.required) {
      console.error(`ERROR: required entrypoint not found: ${job.entrypoint}`)
      return false
    }
    console.warn(`WARNING: optional entrypoint not found, skipping: ${job.entrypoint}`)
    console.warn(`         (the memory-mcp server is built in a separate task)`)
    return true
  }

  console.log(`Building: ${job.entrypoint}`)
  const result = await Bun.build({
    entrypoints: [job.entrypoint],
    outdir: DIST_DIR,
    target: "bun",
    format: "esm",
    external: EXTERNAL,
    naming: job.naming,
  })

  if (!result.success) {
    console.error(`FAIL: build failed for ${job.entrypoint}`)
    for (const log of result.logs) {
      console.error(`  ${log}`)
    }
    return false
  }

  // Ensure the artifact lands at the intended outfile path. Bun.build derives
  // the output name from the entry basename by default; if a naming override did
  // not produce the exact intended filename, rename the single output.
  if (!existsSync(job.outfile)) {
    const outputs = result.outputs
    if (outputs.length === 1) {
      const produced = outputs[0]
      if (produced !== undefined && produced.path !== job.outfile) {
        renameSync(produced.path, job.outfile)
      }
    }
  }

  if (!existsSync(job.outfile)) {
    console.error(`FAIL: expected artifact not found at ${job.outfile}`)
    return false
  }

  const size = statSync(job.outfile).size
  console.log(`  artifact: ${job.outfile} (${formatBytes(size)})`)
  return true
}

async function main(): Promise<void> {
  console.log(`dist dir: ${DIST_DIR}`)
  let ok = true
  for (const job of jobs) {
    const success = await runJob(job)
    if (!success) {
      ok = false
    }
  }
  if (!ok) {
    console.error("Build completed with failures.")
    process.exit(1)
  }
  console.log("Build completed successfully.")
}

await main()
