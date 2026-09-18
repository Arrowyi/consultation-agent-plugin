import { describe, expect, test } from "bun:test"
import { computeInstallMetadata, resolvePluginEntry, toFileUrl, writerAssetPathForEntry } from "./integration-helpers.ts"

describe("writerAssetPathForEntry", () => {
  test("resolves the writer asset for an installed bundle entry", () => {
    const entry = "/tmp/stage/consultation-agent-plugin/dist/index.js"

    const assetPath = writerAssetPathForEntry(entry)

    expect(assetPath).toBe("/tmp/stage/consultation-agent-plugin/assets/agents/writer.md")
  })

  test("resolves the writer asset from a file:// URL", () => {
    const entry = "file:///tmp/stage/consultation-agent-plugin/dist/index.js"

    const assetPath = writerAssetPathForEntry(entry)

    expect(assetPath).toBe("/tmp/stage/consultation-agent-plugin/assets/agents/writer.md")
  })

  test("returns undefined for a source-mode entry", () => {
    const entry = "/repo/packages/opencode-adapter/src/index.ts"

    const assetPath = writerAssetPathForEntry(entry)

    expect(assetPath).toBeUndefined()
  })

  test("decodes a file:// URL with encoded spaces", () => {
    const entry = "file:///tmp/my%20dir/consultation-agent-plugin/dist/index.js"

    const assetPath = writerAssetPathForEntry(entry)

    expect(assetPath).toBe("/tmp/my dir/consultation-agent-plugin/assets/agents/writer.md")
  })
})

describe("toFileUrl", () => {
  test("leaves an existing file:// URL unchanged", () => {
    expect(toFileUrl("file:///tmp/stage/dist/index.js")).toBe("file:///tmp/stage/dist/index.js")
  })

  test("prefixes a bare path with file://", () => {
    expect(toFileUrl("/tmp/stage/dist/index.js")).toBe("file:///tmp/stage/dist/index.js")
  })

  test("encodes spaces in a bare path using pathToFileURL", () => {
    expect(toFileUrl("/tmp/my dir/dist/index.js")).toBe("file:///tmp/my%20dir/dist/index.js")
  })
})

describe("computeInstallMetadata", () => {
  test("returns prefix, install root, and entry for cleanup", () => {
    const metadata = computeInstallMetadata("/tmp/consult-install-abc")

    expect(metadata.prefix).toBe("/tmp/consult-install-abc")
    expect(metadata.installRoot).toBe("/tmp/consult-install-abc/consultation-agent-plugin")
    expect(metadata.entry).toBe("/tmp/consult-install-abc/consultation-agent-plugin/dist/index.js")
  })
})

describe("resolvePluginEntry", () => {
  test("returns an override kind when CONSULTATION_PLUGIN_ENTRY is set", async () => {
    const original = process.env.CONSULTATION_PLUGIN_ENTRY
    process.env.CONSULTATION_PLUGIN_ENTRY = "file:///tmp/stage/dist/index.js"
    try {
      const result = await resolvePluginEntry()

      expect(result.kind).toBe("override")
      expect(result.entry).toBe("file:///tmp/stage/dist/index.js")
    } finally {
      if (original === undefined) {
        delete process.env.CONSULTATION_PLUGIN_ENTRY
      } else {
        process.env.CONSULTATION_PLUGIN_ENTRY = original
      }
    }
  })
})
