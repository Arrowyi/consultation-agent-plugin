import type { RevisionStatus } from "./enums.ts"
import { MemoryError } from "./errors.ts"

const transitions: Readonly<Record<RevisionStatus, readonly RevisionStatus[]>> = {
  active: ["superseded", "refuted", "retired", "forgotten"],
  superseded: ["retired", "forgotten"],
  refuted: ["retired", "forgotten"],
  retired: ["active", "forgotten"],
  forgotten: [],
}

export function assertTransition(from: RevisionStatus, to: RevisionStatus): void {
  if (!transitions[from].includes(to)) {
    throw new MemoryError("ILLEGAL_TRANSITION", `Cannot transition from ${from} to ${to}`)
  }
}
