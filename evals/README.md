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

- `fixtures/consultation-cases.json` - 14 cases from architecture 17.1 plus C15-C25 task-fit routing scenarios.
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

Model-graded cases (C3, C4, C5, C6, C7, C8, C10, C11, C12, C13, C14, C15-C25, M3, M5) have no test-file
mapping by design.

## Task-fit routing evaluation (C15-C25)

For each scenario, a reviewer first records which role tasks are plausibly relevant and which are demonstrably unnecessary **before** looking at the run's tool calls. The rubric grades task fit and usable output, not the total number of subagents. A second reviewer can challenge the pre-labeling when a source or user constraint changes. Preserve the exact task and model/configuration across baseline and revised runs; three independent runs of each unambiguous case are a release gate, not a statistical guarantee.

For each user turn, record the active **message** agent (not only the session label), user constraints, the reason a role is plausible or clearly unnecessary, the tool name and `consultation_dispatch` input role, whether its child result contains usable text, and whether the final answer adopts or qualifies the result. Inspect chronological dependencies: gather evidence before analysis, form a candidate conclusion before critique, and approve an author outline before requesting manuscript prose. Also record final answer quality, source support, latency, token usage, and missing checks. Keep private user messages, credentials, full transcripts, and raw source copies out of this repository.

Use host session/message/part records for observational baseline examples. A prior session with zero dispatches shows what happened, **not** whether each work unit warranted a specialist or whether conversation length caused the decision. Paired live runs are required for a causal before/after comparison. In C22, begin with another primary agent for several turns, switch to consultant for the same new research request used in a fresh consultant session, and inspect `message.data.agent` per turn. In C21, use a controlled empty-child result and the dispatch-tool unit test; do not assume a provider will produce an empty reply on demand.

C16's exclusion applies only to a clearly non-promotional authoritative specification. C23 is its positive-control counterpart: the source may be official while its claim about independent reviewers still needs an influence audit. C24 must run in a separate isolated config with `verifier_enabled: false`; verify both the dispatch preflight and the final answer's disclosure. C25 checks the writer blueprint before the outline gate, not chapter prose before approval. If model access, quotas, or installed skill overrides prevent a live run, report the exact missing verification instead of marking it passed.
