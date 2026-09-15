import { createHash } from "node:crypto"

/**
 * Compute the memory namespace for a project.
 *
 * The namespace isolates memory entries per install/project. It is derived
 * from the OpenCode project id when present, falling back to the working
 * directory. The format is `oc-` plus the first 12 hex characters of a
 * sha256 digest over the chosen source string.
 */
export function computeNamespace(
  projectId: string | undefined,
  directory: string,
): string {
  const source = projectId ?? directory
  const hash = createHash("sha256").update(source).digest("hex")
  return "oc-" + hash.slice(0, 12)
}
