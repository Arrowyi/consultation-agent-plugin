# Consultant Task-Fit Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route consultation work to the best-suited role, including uncertain-but-relevant checks and substantive writer drafts, without introducing dispatch quotas or silent success on empty subagent output.

**Architecture:** The consultation skill owns the task-fit policy; the consultant prompt is its concise entry point. The adapter remains a narrow role/model dispatcher and validates role availability and usable output. Existing config keys remain compatible. Behavioral suitability is graded using pre-registered live scenarios and actual tool traces, not prompt-string assertions or raw dispatch counts.

**Tech Stack:** Bun, TypeScript, Zod, OpenCode plugin API, Markdown agent/skill assets, JSON evaluation fixtures.

**Spec:** `docs/superpowers/specs/2026-09-29-consultant-task-routing-design.md`

## Global Constraints

- Dispatch a plausible specialist when its work could materially matter **or relevance cannot be ruled out**; skip only with a task-specific reason. This is not a requirement to invoke every role.
- Keep `tier_role_caps` and `team_caps` as ceilings; do not add per-turn mutable system-prompt injection, remove the consultant's direct tools, or add background-job infrastructure.
- Keep the author outline/destination approval gate. Plugin-owned writer remains `edit: deny, bash: deny`; delegated writer permissions are external and must not be misrepresented.
- Do not equate a dispatch call with a usable result. A disabled role, exhausted cap, or empty/failed child result is a disclosed gap, not a clean audit or successful analysis.
- Work from `packages/`, `assets/`, `docs/`, `evals/`; never hand-edit `dist/` or installed artifacts. Follow `AGENTS.md`: `bun test`, `bun run typecheck`, `bun run install:local`, then installed-bundle integration. Restart OpenCode after install.
- No Git commit is authorized by the present request. If the user explicitly requests commits later, inspect status/diff/history, stage only intended files, and follow the repository's Git workflow.

## File map and boundaries

| File | Responsibility |
| --- | --- |
| `evals/fixtures/consultation-cases.json`, `evals/README.md` | Pre-registered positive/negative routing and multi-turn scenarios; rubric and evidence collection protocol. Existing `evals/run-evals.ts` already reads consultation cases. |
| `assets/skills/consultation/SKILL.md` | Authoritative role suitability policy, uncertainty/skip semantics, dependency order, author workflow. |
| `assets/agents/consultant.md` | Short, consistent routing reminder; user interaction, synthesis and file-delivery boundaries. |
| `assets/agents/{explorer,analyst,consultation-critic,consultation-verifier,writer}.md` | Specialist contracts; substantive writer drafts and bounded source-influence triage are substantive changes. |
| `packages/opencode-adapter/src/dispatch-tool.ts` + `.test.ts` | Enabled-role preflight and unusable empty child results, without a new orchestration state machine. |
| `packages/opencode-adapter/src/agent-registration.ts` + `.test.ts` | Runtime bindings mark role caps as maxima and keep static capability reporting. |
| `docs/architecture.md`, `docs/deployment.md`, `README.md` | Reconcile standard/deep policy, capabilities, writer delegation and public documentation with the shipped assets. |

## Review Focus

1. An explicit `writer_delegate_agent` with `writer_enabled: false` must continue to route as the configured delegate; its host permissions are **not** automatically the plugin-owned read-only policy (Task 2 tests, Task 4 docs).
2. A completed child response with zero parts, whitespace-only text, or only non-text parts must not be treated as a successful specialist result (Task 2 tests).
3. An official *product marketing claim* is not an automatic verifier-negative just because the publisher is official; only a clearly scoped authoritative specification without promotional/third-party dependence is (Task 1 fixtures C16/C23, Task 4 live check).
4. A late switch from a different primary agent must not inherit that agent's old routing choices as consultant policy, while retaining the user's constraints and any verified evidence (Task 1 fixture C22, Task 3/5 live checks).
5. If the installed skill starts with `<!-- user-modified -->`, the installer intentionally preserves it: release verification must detect the mismatch and not claim the new routing instructions reached that install (Task 4).

---

### Task 1: Pre-register a task-fit behavioral baseline

**Files:** Modify `evals/fixtures/consultation-cases.json`, `evals/README.md`.

**Interfaces:** Produces existing `EvalCase` records with `id`, `title`, `given`, `when`, `then`, `grading: "model"`, and a `notes` field beginning `Rubric:`. These are consumed without modification by `evals/run-evals.ts`. Does not create a private transcript archive in the repository.

- [ ] **Step 1: Add nine model-graded cases, C15–C23.** C15: ambiguous sponsored review → verifier; C16: known non-promotional authoritative specification → no verifier; C17: conflicting evidence → explorer then analyst then critic; C18: short direct fact → no irrelevant role; C19: high-uncertainty plan step → critic; C20: substantive chapter after approved outline → writer draft; C21: no usable child text → explicit gap; C22: late switch into consultant → fresh task-level routing; C23: official product marketing claim with unresolved independence → verifier, not the C16 exclusion. Use concrete `given/when/then` language; for C15:

  ```json
  {
    "id": "C15",
    "title": "Unclear review independence triggers intent triage",
    "given": "A recommendation rests on third-party reviews with unknown sponsorship and insufficient account history.",
    "when": "The consultant assesses the load-bearing review evidence",
    "then": "It dispatches verifier without first requiring proof of manipulation; missing signals alone must not yield clean.",
    "grading": "model",
    "notes": "Rubric: Check the actual verifier tool call, supplied review packet, and an unknown result when the available signals cannot settle intent."
  }
  ```

- [ ] **Step 2: Record how to evaluate independently.** In `evals/README.md`, explain that the reviewer pre-labels plausible roles from the user task before seeing the tool trace; capture per user turn `message.data.agent`, tool name, dispatch input role, child output usability, and the resulting user-visible conclusion. Reuse prior consultation sessions as observational examples, not causal proof of multi-turn degradation. Do not copy private transcripts or credentials into the repo. C23 is the positive-control counterpart to C16: an official publisher can still make an unsupported promotional claim.
- [ ] **Step 3: Verify fixture parsing.** Run `bun run evals/run-evals.ts`; expect nine additional `MANUAL` cases, no `UNMAPPED` or `MISSING-TEST`. Save baseline rubric and existing installed-artifact details before changing the install prefix, so later comparisons use the same model/config and tasks. If historical runs cannot be repeated, report that as a limitation rather than calling them a controlled baseline.

### Task 2: Make the dispatch result trustworthy without adding quotas

**Files:** Modify `packages/opencode-adapter/src/dispatch-tool.test.ts`, `packages/opencode-adapter/src/dispatch-tool.ts`.

**Interfaces:** `createConsultationDispatchTool(client): ToolDefinition` and `resolveRoleTarget(config,role): RoleTarget` retain their signatures; `execute` still returns a string. A disabled role produces `Error: <role> is disabled by configuration`, before `session.create`; an empty child result produces `Error: <role> dispatch returned no usable text`, not the current success-shaped placeholder. Configured writer delegate remains an explicit override. Other retryable-model and ordinary error behavior remains unchanged.

- [ ] **Step 1: Add failing tests** using the existing in-memory `fakeClient` pattern. Assert zero `session.create` calls for `critic_enabled: false`, `verifier_enabled: false`, `writer_enabled: false` without a delegate, and successful delegate routing when `writer_delegate_agent` is provided. Assert that `parts: []`, whitespace text, and non-text-only parts each yield a string starting with `Error:` and naming the role. Assert valid nonempty text is returned unchanged, and existing writer quota fallback still tries at most the configured models. Use `writeFileSync(configPath, JSON.stringify({ critic_enabled: false }))` for the critic case, `{ verifier_enabled: false }` for verifier, `{ writer_enabled: false }` for bundled writer, and `{ writer_enabled: false, writer_delegate_agent: "host-writer" }` for delegation. Run `bun test packages/opencode-adapter/src/dispatch-tool.test.ts`; expected RED only for newly added cases.

  Follow the existing `fakeClient` setup at `dispatch-tool.test.ts:133-177`; one new test's essential assertion is:

  ```typescript
  // Given: the fake session.prompt returns { data: { parts: [] } }.
  // When: the configured analyst is dispatched.
  const result = await dispatchTool.execute({ role: "analyst", prompt: "analyze evidence" }, fakeContext())
  // Then: an empty child cannot satisfy the specialist check.
  expect(result).toBe("Error: analyst dispatch returned no usable text")
  ```
- [ ] **Step 2: Implement minimal preflight and empty-result handling.** Check booleans after loading config, before resolving target/creating a session; treat explicit delegate as writer-active even if the bundled writer is disabled (matching `buildRuntimeBindings`). Make `extractText` return `string | undefined` for trimmed-empty text and convert `undefined` to the specified error in `execute`. Keep `finally` cleanup; do not turn empty output into a successful result, add a global counter, or silently retry forever. No tier-based runtime rejection is added because `execute` does not know the consultant's tier; tier caps are communicated as ceilings in Task 3.

  Insert the preflight ahead of `resolveRoleTarget` and replace the old placeholder return path:

  ```typescript
  const enabled: Record<DispatchRole, boolean> = {
    explorer: true,
    analyst: true,
    critic: config.critic_enabled,
    verifier: config.verifier_enabled,
    writer: config.writer_enabled || config.writer_delegate_agent !== undefined,
  }
  if (!enabled[args.role]) return `Error: ${args.role} is disabled by configuration`
  // extractText now returns undefined for zero, whitespace, or non-text parts.
  const text = extractText(promptResult.data.parts ?? [])
  return text ?? `Error: ${args.role} dispatch returned no usable text`
  ```
- [ ] **Step 3: Run focused tests and static gate.** `bun test packages/opencode-adapter/src/dispatch-tool.test.ts && bun run typecheck`; expected PASS. Use `lsp_diagnostics` on both modified TypeScript files and inspect the changed-file LOC/strict-style review before accepting.

### Task 3: Replace mode quotas with task-fit routing

**Files:** Modify `assets/skills/consultation/SKILL.md`, `assets/agents/consultant.md`, `packages/opencode-adapter/src/agent-registration.ts`, `docs/architecture.md`. Preserve the other role assets in this task.

**Interfaces:** The skill is the authoritative policy: a specialist is called when plausibly relevant and skipped only with a task-specific reason. `buildRuntimeBindings(config, namespace): string` retains its signature, values, and DISABLED-status reporting but labels configured caps as ceilings. Task 4 extends individual role contracts under that policy.

- [ ] **Step 1: Establish the live RED case before editing policy.** Run C17 (conflicting evidence), C18 (direct fact), and C22 (late switch) on the existing installed consultant with the Task 1 rubric and actual tool traces. If a case passes, preserve it as a regression case; do not claim it reproduced the reported bug. Do **not** test English prompt prose with string snapshots or natural-language `toContain` assertions.
- [ ] **Step 2: Change the skill's routing contract.** Rewrite `assets/skills/consultation/SKILL.md` workflow, team, research, plan, guide, author, and counter-evidence dispatch requirements where they conflict with per-task decisions. Keep fast concise answers, deep consent, risk thresholds, role dependency order, and explicit gaps for disabled/exhausted roles. Add the exact decision boundary:

  ```text
  For each potentially relevant role, dispatch a bounded task when its specialist
  check could change a material claim, decision, or deliverable, or when that
  relevance cannot yet be ruled out. Skip only with a task-specific reason.
  Tier role caps are maximums, never a required roster. Preserve deep approval.
  ```

- [ ] **Step 3: Align consultant and runtime bindings.** Shorten `assets/agents/consultant.md` team summary to defer to the skill while retaining the five role names, fallback disclosure, and synthesis responsibility; remove unconditional standard/deep roster language. In `agent-registration.ts` label `tierMatrixLine` and the round/explorer limits as maximums, not completed work. Keep existing agent/model/namespace bindings and prompt assembly unchanged. `bun test packages/opencode-adapter/src/agent-registration.test.ts` must still pass; do not add prose-snapshot tests.
- [ ] **Step 4: Resolve architecture wording.** Update `docs/architecture.md` standard/deep tier statements and role-cap section to match asymmetric skip semantics: `tier_role_caps` is compatible and limits how many calls a role can receive, not the minimum number a turn must make. Do not claim a new runtime cap enforcer exists.
- [ ] **Step 5: Verify the policy unit.** Run `bun test packages/opencode-adapter/src/agent-registration.test.ts && bun run typecheck && bun run evals/run-evals.ts`; inspect C17/C18/C22 live tool traces with the frozen rubric. `lsp_diagnostics` on the changed `agent-registration.ts`; if live evaluation is blocked, report the gap and leave the behavioral claim unverified.

### Task 4: Extend specialist work to source influence and substantive prose

**Files:** Modify `assets/agents/consultation-verifier.md`, `assets/agents/writer.md`, `assets/skills/consultation/SKILL.md`, `assets/agents/consultant.md`, `README.md`, `docs/deployment.md`, and verifier/writer descriptions in `packages/opencode-adapter/src/agent-registration.ts` if those descriptions conflict. Keep `explorer.md`, `analyst.md`, and `consultation-critic.md` unchanged unless a concrete contradiction is identified.

**Interfaces:** Writer returns a blueprint/review before approval, or an approved section/chapter manuscript with marked unsupported facts after approval; consultant owns final verification and file/inline delivery. Verifier reports observable manipulation/influence signals, source-independence limits and `unknown` for missing evidence, not an unsupported `clean` verdict. Plugin-owned writer retains deny-edit/deny-bash; a delegated writer's host permissions remain external.

- [ ] **Step 1: Establish specialist RED cases.** Run C15 (unknown review sponsorship), C16 (non-promotional authoritative specification), C20 (approved chapter draft), and C23 (official promotional claim) on the existing installed consultant with the pre-registered Task 1 rubric; capture role calls and child output usability. If a case already passes, treat it as a regression control rather than invented failure.
- [ ] **Step 2: Update verifier's contract.** Extend `assets/agents/consultation-verifier.md` to cover bounded independence/influence triage of uncertain third-party and promotional evidence, not general truth checking. Update the intent audit section of the skill and the consultant's verifier summary to reflect evidence-based `unknown`. The role-output boundary is:

  ```text
  If evidence for sponsorship or coordination is missing, return intent="unknown",
  name the missing observable signals, and do not label a source "clean" merely
  because no pattern was detectable. Never claim one unverified post is fake.
  ```

- [ ] **Step 3: Update writer's contract.** In `assets/agents/writer.md` and the skill's author workflow, add manuscript drafting **after** the approved outline and destination; retain blueprint/review before approval. Supply a bounded evidence packet, audience, section goal, terminology and neighboring-section summaries. Require real reader-facing prose with unsupported facts marked; forbid file edits, invented citations, claimed unrun execution, and independent factual research. Update the consultant's author summary to delegate drafts while keeping it responsible for final verification and writing the file. The role-output boundary is:

  ```text
  When the supplied outline is approved, return the requested chapter or section's
  full reader-facing prose plus marked unsupported claims. Do not write files or
  claim that an example ran unless its execution result was supplied.
  ```

- [ ] **Step 4: Align public descriptions.** In `README.md`, `docs/deployment.md`, and, if necessary, the verifier/writer descriptions in `agent-registration.ts`, describe the broader verifier scope and writer manuscript output. State that delegate-writer host permissions are not imposed by the plugin. Keep the prior role/model defaults and assertions intact; do not infer that a model is objectively better without evaluation.
- [ ] **Step 5: Verify specialist contracts.** Run `bun test packages/opencode-adapter/src/agent-registration.test.ts && bun run typecheck && bun run evals/run-evals.ts`; inspect C15/C16/C20/C23 tool traces and the output against the frozen rubrics. `lsp_diagnostics` on `agent-registration.ts` if edited. Before declaring behavior improved, verify the installed skill will actually receive asset changes (a `<!-- user-modified -->` installed skill will not be overwritten).

### Task 5: Prove task fit in a packaged install and report residual gaps

**Files:** No product-file changes unless an evaluation reveals a specific defect. Update `evals/README.md` only if the execution rubric needs clarification; evidence from private sessions stays outside the repository.

**Interfaces:** Produces a reviewed result per fixture: expected task-to-role assignment, actual role call and usable result, justified inline decisions, source support, latency, token cost, and any residual uncertainty. No automatic "dispatch-count pass" metric.

- [ ] **Step 1: Run the repository gates** in order: `bun test`, `bun run typecheck`, `bun run install:local`, `CONSULTATION_PLUGIN_ENTRY=~/.local/share/consultation-agent-plugin/dist/index.js bun run integration`. Inspect actual exit statuses; never claim a skipped integration is a pass. Run `lsp_diagnostics` for every modified TypeScript file and verify installed `assets/skills/consultation/SKILL.md` has the expected effective policy (respect the user-modified marker).
- [ ] **Step 2: Run paired live consultations** under the same model and config on the Task 1 fixtures: three independent runs each for unambiguous positive and negative cases, plus conditional human-graded cases. Include a real multi-turn session that starts with a different primary agent and switches to consultant for a fresh task. Collect the tool trace, not just the final answer; verify the writer returns usable prose **after** approval, verifier handles unknown provenance without unsupported certainty, and failure/disabled cases visibly disclose gaps. Compare baseline and revised artifact latency/tokens and factual quality, not merely calls per session. If live OpenCode access or model quota prevents this, stop and report exactly which behavior could not be verified; do not claim the routing issue is fixed.
- [ ] **Step 3: Review outcomes before release.** For clear positives require appropriate specialist work and a usable result in all three revised runs; for clear negatives require no irrelevant role in all three; for failures require honest disclosure in all three. Conditional scenarios use the pre-registered rubric, not a forced call set. If prose-only routing still misses a specialist, inspect the exact trace and propose a targeted next change rather than adding a quota/counter reflexively. Deliver the observed results and any unverified paths to the user. Commit only if separately requested.
