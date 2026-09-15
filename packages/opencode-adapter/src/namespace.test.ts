import { describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import { computeNamespace } from "./namespace.ts"

describe("computeNamespace", () => {
  it("returns oc- prefix plus first 12 hex chars of sha256 of project.id when present", () => {
    // given
    const projectId = "proj-abc-123"
    const directory = "/tmp/irrelevant"
    const expected = "oc-" + createHash("sha256").update(projectId).digest("hex").slice(0, 12)

    // when
    const ns = computeNamespace(projectId, directory)

    // then
    expect(ns).toBe(expected)
    expect(ns.startsWith("oc-")).toBe(true)
    expect(ns.length).toBe(15)
  })

  it("falls back to directory when project.id is undefined", () => {
    // given
    const projectId = undefined
    const directory = "/home/user/my-project"
    const expected = "oc-" + createHash("sha256").update(directory).digest("hex").slice(0, 12)

    // when
    const ns = computeNamespace(projectId, directory)

    // then
    expect(ns).toBe(expected)
  })

  it("uses an empty project.id because it is distinct from an absent id", () => {
    // given
    const projectId = ""
    const directory = "/home/user/empty-id-project"
    const expected = "oc-" + createHash("sha256").update(projectId).digest("hex").slice(0, 12)

    // when
    const ns = computeNamespace(projectId, directory)

    // then
    expect(ns).toBe(expected)
  })

  it("produces deterministic output for the same inputs", () => {
    // given
    const projectId = "stable-id"
    const directory = "/tmp/dir"

    // when
    const a = computeNamespace(projectId, directory)
    const b = computeNamespace(projectId, directory)

    // then
    expect(a).toBe(b)
  })

  it("produces different namespaces for different project ids", () => {
    // given
    const directory = "/tmp/same-dir"

    // when
    const a = computeNamespace("id-one", directory)
    const b = computeNamespace("id-two", directory)

    // then
    expect(a).not.toBe(b)
  })
})
