# Evaluation Fixtures

This directory holds the evaluation fixtures for the consultation agent plugin,
derived from architecture sections 17.1 (Consultation Evaluation Cases) and 17.2
(Memory Evaluation Cases).

## Two-tier grading

Every case is marked with one of two grading tiers:

- **deterministic** - The case reduces to a pure function or a store operation
  that is already covered by a package unit test. The runner prints the test file
  that covers it. Run `bun test` to verify these. No live model is needed.
- **model** - The case requires a live consultant agent (a real model) to judge
  behavior that cannot be pinned by a pure function, such as reconciling
  conflicting sources, disclosing memory use, or honestly abstaining when
  evidence is insufficient. The runner prints `MANUAL` and the rubric question a
  reviewer must answer. The runner never calls a model.

## Files

- `fixtures/consultation-cases.json` - 10 cases from architecture 17.1.
- `fixtures/memory-cases.json` - 12 cases from architecture 17.2.
- `run-evals.ts` - The runner script.

Each case has the shape:

```json
{
  "id": "C1",
  "title": "...",
  "given": "...",
  "when": "...",
  "then": "...",
  "grading": "deterministic | model",
  "notes": "test file or rubric question"
}
```

## How to run

From the repository root:

```bash
bun run evals/run-evals.ts
```

The runner loads both fixture files, prints a per-case checklist grouped by
grading, marks deterministic cases with the covering package test file, prints
`MANUAL` plus the rubric question for model-graded cases, and exits 0. It makes
no live model calls.

To actually verify the deterministic cases, run the package test suite:

```bash
bun test
```

To verify the model-graded cases, run a live consultant agent against the
given/when/then scenario and answer the printed rubric question for each.

## Deterministic coverage map

The runner keeps an inline table mapping each deterministic case id to the
package unit test file that covers it. The mapping is a convention: the case
id encodes the scenario, and the test file encodes the function under test.

| Case | Test file |
| --- | --- |
| C1 | packages/consultation-core/src/tier-router.test.ts |
| C2 | packages/consultation-core/src/source-grading.test.ts |
| C9 | packages/memory-core/src/injection.test.ts |
| M1 | packages/memory-sqlite/src/store.test.ts |
| M2 | packages/memory-sqlite/src/store.test.ts |
| M4 | packages/memory-sqlite/src/store.test.ts |
| M6 | packages/memory-core/src/retrieval-plan.test.ts |
| M7 | packages/memory-sqlite/src/store.test.ts |
| M8 | packages/memory-sqlite/src/store.test.ts |
| M9 | packages/memory-sqlite/src/store.test.ts |
| M10 | packages/memory-sqlite/src/cli.test.ts |
| M11 | packages/memory-sqlite/src/store.test.ts |
| M12 | packages/memory-sqlite/src/writer-lock.test.ts |

Model-graded cases (C3, C4, C5, C6, C7, C8, C10, M3, M5) have no test-file
mapping by design.
