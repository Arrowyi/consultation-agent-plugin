# Evaluation Fixtures

This directory holds the evaluation fixtures for the consultation agent plugin,
derived from architecture sections 17.1 (Consultation Evaluation Cases) and 17.2
(Memory Evaluation Cases).

## Two-tier grading

Every case is marked with one of two grading tiers:

- **deterministic** - The case's executable contract is covered by a pure-function,
  store, or dispatch-lifecycle regression test. The runner prints the test file
  that covers it. Run `bun test` to verify these. No live model is needed.
- **model** - The case requires a live consultant agent (a real model) to judge
  behavior that cannot be pinned by a pure function, such as reconciling
  conflicting sources, disclosing memory use, or honestly abstaining when
  evidence is insufficient. The runner prints `MANUAL` and the rubric question a
  reviewer must answer. The runner never calls a model.

## Files

- `fixtures/consultation-cases.json` - 14 cases from architecture 17.1, C15-C25 task-fit routing scenarios, and C26-C30 recoverable lifecycle cases.
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

`PASS (deterministic) -> <files>` means the mapping exists and its files are on
disk, not that the runner executed those tests. A printed checklist is neither
an executable test pass nor a live evaluation pass.

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
| C26 | packages/opencode-adapter/src/dispatch-registration.test.ts; packages/opencode-adapter/src/dispatch-lifecycle.test.ts; packages/opencode-adapter/src/dispatch-observer.test.ts |
| C27 | packages/opencode-adapter/src/dispatch-observer.test.ts; packages/opencode-adapter/src/dispatch-lifecycle.test.ts |
| C28 | packages/opencode-adapter/src/dispatch-lifecycle.test.ts |
| C29 | packages/opencode-adapter/src/dispatch-cancel.test.ts |
| C30 | packages/opencode-adapter/src/dispatch-lifecycle.test.ts; packages/opencode-adapter/src/dispatch-tool.test.ts; packages/opencode-adapter/src/dispatch-registration.test.ts |
| M1 | packages/memory-sqlite/src/store.test.ts |
| M2 | packages/memory-sqlite/src/store.test.ts |
| M4 | packages/memory-sqlite/src/store.test.ts |
| M6 | packages/memory-core/src/retrieval-plan.test.ts |
| M7 | packages/memory-sqlite/src/store.test.ts |
| M8 | packages/memory-sqlite/src/store.test.ts |
| M9 | packages/memory-sqlite/src/store.test.ts |
| M10 | packages/memory-sqlite/src/cli.test.ts |
| M11 | packages/memory-sqlite/src/store.test.ts |
| M12 | packages/memory-sqlite/src/multi-instance.test.ts |

Model-graded cases (C3, C4, C5, C6, C7, C8, C10, C11, C12, C13, C14, C15-C25, M3, M5) have no test-file
mapping by design.

## Recoverable lifecycle evaluation (C26-C30)

These five cases are deterministic **at the tool/observer contract level**:
pending-live recovery, unknown classification without resubmission, late-result
recovery through a fresh coordinator, normal completion winning cancellation,
and configured writer fallback selection. Their notes name exact regression
tests. Run the cited `bun test` files (or the full suite) to prove those contracts.
The coordinator tests use controlled SDK evidence and clocks; they are not an
installed-host restart proof. `dispatch-prompt.test.ts` separately checks
machine-readable status and next-action identifiers, not natural-language compliance.

Consultant attribution, eventual integration, and disclosure still require a
live model run reviewed against each case's `Rubric:` notes. Record this level
separately from executable results; do not promote a deterministic pass into a
live-model pass. For pending-live, inspect launch → pending → same-job wait →
original report → final integration. Independent preparation may continue within
permissions and caps but must not be credited as the awaited independent check.
For unknown, require honest unresolved-gap disclosure or same-job observation.

Adversarial rubric: **Reject “300s means failed”, silent inline substitution,
abort-on-expiry, and unknown-triggered backup model.** Also reject duplicate
generation presented as recovery and cancelled claims after normal completion.
Host session/message evidence, not specialist claims of being alive, determines
execution status; a verifier's evidence-quality `unknown` is not dispatch failure.
Keep private messages, credentials, raw source copies and full transcripts out
of repository evidence; retain only redacted structural observations and verdicts.

### Per-role audit matrix

All five roles share the identical recoverable launch/wait/cancel lifecycle:
`consultation_dispatch{role,prompt}`, `consultation_dispatch_wait{job_id,wait_ms?}`,
and `consultation_dispatch_cancel{job_id}`. Only the bundled writer has a configured
multi-model fallback chain (primary + `writer_fallback_models`). Non-writer roles
and delegate writer each have exactly one configured attempt, no fallback advance.
A delegate model may be `null` in the durable job spec (host model selection),
and its host permissions are retained, not replaced by bundled restrictions.

| Role/target | Recoverable lifecycle | Configured attempts | Audit emphasis |
| --- | --- | --- | --- |
| explorer | Same launch/wait/cancel | One | Recover original evidence report; no duplicated gathering on expiry |
| analyst | Same launch/wait/cancel | One | Integrate returned analysis; inline reasoning is not an independent check |
| critic | Same launch/wait/cancel | One | Await challenge before dependent synthesis; no false review credit |
| verifier | Same launch/wait/cancel | One | Separate execution status from evidence-quality uncertainty |
| bundled writer | Same launch/wait/cancel | Primary + configured fallbacks | Advance only on confirmed terminal retryable failure; preserve outline gate |
| delegate writer | Same launch/wait/cancel | One, pinned model or host selection | No plugin fallback advance; retain external host permissions |

Exercise pending/unknown/recovery/cancel for each role and both delegate model
forms. Check configured-attempt routing separately from host-internal provider
retries; the plugin cannot claim control of an external delegate's internals.

## Task-fit routing evaluation (C15-C25)

For each scenario, a reviewer first records which role tasks are plausibly relevant and which are demonstrably unnecessary **before** looking at the run's tool calls. The rubric grades task fit and usable output, not the total number of subagents. A second reviewer can challenge the pre-labeling when a source or user constraint changes. Preserve the exact task and model/configuration across baseline and revised runs; three independent runs of each unambiguous case are a release gate, not a statistical guarantee.

For each user turn, record the active **message** agent (not only the session label), user constraints, the reason a role is plausible or clearly unnecessary, the tool name and `consultation_dispatch` input role, whether its child result contains usable text, and whether the final answer adopts or qualifies the result. Inspect chronological dependencies: gather evidence before analysis, form a candidate conclusion before critique, and approve an author outline before requesting manuscript prose. Also record final answer quality, source support, latency, token usage, and missing checks. Keep private user messages, credentials, full transcripts, and raw source copies out of this repository.

Use host session/message/part records for observational baseline examples. A prior session with zero dispatches shows what happened, **not** whether each work unit warranted a specialist or whether conversation length caused the decision. Paired live runs are required for a causal before/after comparison. In C22, begin with another primary agent for several turns, switch to consultant for the same new research request used in a fresh consultant session, and inspect `message.data.agent` per turn. In C21, use a controlled empty-child result and the dispatch-tool unit test; do not assume a provider will produce an empty reply on demand.

C16's exclusion applies only to a clearly non-promotional authoritative specification. C23 is its positive-control counterpart: the source may be official while its claim about independent reviewers still needs an influence audit. C24 must run in a separate isolated config with `verifier_enabled: false`; verify both the dispatch preflight and the final answer's disclosure. C25 checks the writer blueprint before the outline gate, not chapter prose before approval. If model access, quotas, or installed skill overrides prevent a live run, report the exact missing verification instead of marking it passed.
