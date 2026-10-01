import { expect, test } from "bun:test"
import { proveDispatchPrimitives } from "./integration-dispatch-primitives.ts"

test("rejects normalized-away journal flags when host persists a noReply record", async () => {
  // Given a wire-level host that strips flags, the risk is journal invisibility.
  const api = async (path: string): Promise<unknown> => {
    if (path.endsWith("/children")) return [{ id: "ses-attempt", parentID: "ses-root", directory: "/sandbox", title: "attempt" }]
    if (path.endsWith("/message")) return [{ info: { id: "msg-primitives", sessionID: "ses-root", role: "user", time: { created: 1 } }, parts: [{ type: "text", id: "prt-1", messageID: "msg-primitives", sessionID: "ses-root", text: "{}" }] }]
    return { id: path === "/session" ? "ses-parent" : "ses-root", parentID: "ses-parent", directory: "/sandbox", title: "root" }
  }
  // When the primitive proof reads the persisted part.
  const assertions = await proveDispatchPrimitives(api, "/sandbox")
  // Then normalization must be a failed assertion, never a silent PASS.
  expect(assertions.find((a) => a.name === "journal ignored/synthetic flags persist")?.pass).toBe(false)
})
