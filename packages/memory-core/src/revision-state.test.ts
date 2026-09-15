import { describe, expect, test } from "bun:test";
import type { RevisionStatus } from "./enums.ts";
import { assertTransition } from "./revision-state.ts";

describe("assertTransition", () => {
  const statuses: readonly RevisionStatus[] = ["active", "superseded", "refuted", "retired", "forgotten"];
  const legal: ReadonlySet<string> = new Set([
    "active:superseded", "active:refuted", "active:retired", "active:forgotten",
    "superseded:retired", "superseded:forgotten",
    "refuted:retired", "refuted:forgotten",
    "retired:active", "retired:forgotten",
  ]);

  for (const from of statuses) {
    for (const to of statuses) {
      const transition = `${from}:${to}`;
      test(`permits only legal transition ${transition}`, () => {
        // given
        const isLegal = legal.has(transition);

        // when
        const attempt = (): void => assertTransition(from, to);

        // then
        if (isLegal) expect(attempt).not.toThrow();
        else expect(attempt).toThrow("ILLEGAL_TRANSITION");
      });
    }
  }

  test("forgotten is terminal: no outgoing transition is legal", () => {
    // given
    const from: RevisionStatus = "forgotten";

    // when // then
    for (const to of statuses) {
      expect(() => assertTransition(from, to)).toThrow("ILLEGAL_TRANSITION");
    }
  });

  test("retired -> active is allowed (revival)", () => {
    // given // when // then
    expect(() => assertTransition("retired", "active")).not.toThrow();
  });

  test("self-transitions are illegal", () => {
    // given // when // then
    for (const s of statuses) {
      expect(() => assertTransition(s, s)).toThrow("ILLEGAL_TRANSITION");
    }
  });
});
