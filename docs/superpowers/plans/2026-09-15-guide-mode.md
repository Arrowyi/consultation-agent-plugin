# `guide` Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fifth, general-purpose consultation mode `guide` (a composite operational package: recommendation + procedure + background) to the consultation agent plugin, additively and backward-compatibly.

**Architecture:** `guide` is a first-class mode. Its output contract `GuideBriefSchema` reuses the existing `SelectCandidateSchema`, `PlanStepSchema`, and shared `baseBriefShape`, and joins the `DecisionBriefSchema` discriminated union. The cross-field rule "a guide must carry a recommendation or a procedure" is enforced as a post-parse check in `validateDecisionBrief` (NOT a top-level `.refine`, which would return a `ZodEffects` that `z.discriminatedUnion` cannot accept). Prompts/docs (`SKILL.md`, `consultant.md`, `README.md`, `docs/architecture.md`) gain the mode definition, routing rule, tier/team behavior, and report template. The memory layer is untouched (it keys on `Tier`, never `ConsultationMode`).

**Tech Stack:** Bun >= 1.1, TypeScript strict, zod ^3.25, `bun:test`. No new dependencies.

## Global Constraints

- Additive only: no behavior change to `select` / `verify` / `plan` / `research`.
- `ConsultationModeSchema` becomes `z.enum(["select", "verify", "plan", "research", "guide"])` — order matters, the test asserts this exact array.
- `GuideBriefSchema` MUST be a plain `z.object` (no top-level `.refine`/`.superRefine`) so `z.discriminatedUnion` accepts it.
- Numeric-confidence rule is blanket: any `NN%` in any user-visible guide string throws `NUMERIC_CONFIDENCE` (scanned via `briefTexts`).
- Error codes come from `ConsultationErrorCode` (`VALIDATION_FAILED`, `NUMERIC_CONFIDENCE`) in `packages/consultation-core/src/errors.ts` — already exported, no change.
- Test framework is `bun:test` (`import { describe, expect, test } from "bun:test"`); run tests with `bun test`.
- Repo gate (from `AGENTS.md`) before done: `bun test` → `bun run typecheck` → `bun run install:local` → `CONSULTATION_PLUGIN_ENTRY=<installed> bun run integration`.
- Doc templates that show Chinese output keep Chinese (the existing research template already mixes Chinese labels); schema field names stay English.
- Commit style: imperative, concise, no prefix (e.g. `Add the guide-mode design spec`).

---

### Task 0: Verify `ConsultationMode` is not referenced outside `consultation-core`

Confirms the memory layer needs no change. Read-only; nothing is modified.

**Files:** none modified.

- [ ] **Step 1: grep for `ConsultationMode` across the three other packages**

Run: `grep -rn "ConsultationMode" packages/memory-core packages/memory-mcp packages/opencode-adapter`
Expected: no output (zero matches). A prior full-repo grep found `ConsultationMode` only in `packages/consultation-core/src/enums.ts` and the design spec.

- [ ] **Step 2: Record the result**

If any match appears, stop and extend that package's schema/tests before continuing (add `"guide"` where the enum is mirrored). If clean, proceed — memory-core/memory-mcp/opencode-adapter need no mode change. No commit (read-only).

---

### Task 1: Add `guide` to `ConsultationModeSchema`

**Files:**
- Test: `packages/consultation-core/src/enums.test.ts`
- Modify: `packages/consultation-core/src/enums.ts:16-24` (doc comment + enum)

**Interfaces:**
- Produces: `ConsultationModeSchema` now includes `"guide"`; `ConsultationMode` type gains the `"guide"` variant. Consumed by Task 2 (`mode: z.literal("guide")`).

- [ ] **Step 1: Write the failing test**

In `packages/consultation-core/src/enums.test.ts`, add `ConsultationModeSchema` to the import block (lines 2-9) and add this test inside the existing `describe("enums", ...)`:

```ts
  it("ConsultationModeSchema has the five modes", () => {
    // given // when // then
    expect(ConsultationModeSchema.options).toEqual(["select", "verify", "plan", "research", "guide"]);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/consultation-core/src/enums.test.ts`
Expected: FAIL — `ConsultationModeSchema.options` is `["select","verify","plan","research"]` (length 4 ≠ 5).

- [ ] **Step 3: Update the enum and its doc comment**

In `packages/consultation-core/src/enums.ts`, add a `guide` bullet to the doc comment (after the `research` bullet, lines 16-23) and add `"guide"` to the enum (line 24):

```ts
/**
 * Decision type the consultation is answering. Orthogonal to Tier (depth).
 * - select: choose among candidates (shopping, comparisons, picking a tool).
 * - verify: verdict on a proposition (rumors, claims, arguments).
 * - plan: produce an actionable plan (lifestyle, fitness, learning).
 * - research: understand a topic deeply (open-ended investigation) — produces a
 *   readable research report, not a decision brief.
 * - guide: composite operational package (recommendation + procedure +
 *   background) for an end-to-end goal — produces an operational playbook, not
 *   a single decision or a pure understanding report.
 */
export const ConsultationModeSchema = z.enum(["select", "verify", "plan", "research", "guide"])
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/consultation-core/src/enums.test.ts`
Expected: PASS (all 7 tests, including the new one).

- [ ] **Step 5: Commit**

```bash
git add packages/consultation-core/src/enums.ts packages/consultation-core/src/enums.test.ts
git commit -m "Add the guide consultation mode to the enum"
```

---

### Task 2: `GuideBriefSchema`, union entry, and `briefTexts`

**Files:**
- Test: `packages/consultation-core/src/decision-brief.test.ts`
- Modify: `packages/consultation-core/src/decision-brief.ts`

**Interfaces:**
- Consumes: `ConsultationMode` `"guide"` (Task 1); existing `SelectCandidateSchema`, `PlanStepSchema`, `baseBriefShape`, `EpistemicStatusSchema`, `ConsultationErrorCode` (all already in `decision-brief.ts`).
- Produces: `GuideBackgroundPointSchema`, `GuideBackgroundPoint`, `GuideBriefSchema`, `GuideBrief`; `DecisionBriefSchema` accepts `mode: "guide"`; `validateDecisionBrief` enforces the ≥1-section rule and scans guide text for numeric confidence.

- [ ] **Step 1: Write the failing tests**

In `packages/consultation-core/src/decision-brief.test.ts`, add this fixture after the `researchBrief` const (after line 98) and the `describe` blocks after the research `describe` (after line 230). `briefWith` (line 100) is reused.

```ts
const guideBrief = {
  mode: "guide",
  conclusion: "Build the PC with the balanced parts list and assemble in order.",
  goal: "Assemble a working mid-range gaming PC.",
  suitedFor: "First-time builders with a mid-range budget.",
  prerequisites: ["A clean workspace", "A Phillips screwdriver"],
  recommendation: [
    { option: "Mid-range GPU", evidenceGrade: "high", intent: "clean", trialAdvice: "Buy from a retailer with returns." },
  ],
  procedure: [
    { step: "Seat the CPU.", support: "verified" },
    { step: "Mount the cooler.", support: "inferred", basis: "Standard cooler mounting order." },
  ],
  background: [
    { point: "Check part compatibility before buying.", status: "verified" },
  ],
  completionCheck: "The PC boots to BIOS.",
  assumptions: ["Parts are compatible."],
  confidence: "medium",
  stability: "conditional",
  verifiedFacts: ["The CPU must be seated before the cooler."],
  synthesis: ["A balanced parts list fits a mid-range budget."],
  sources: [{ title: "Source 1", grade: "high" }],
  nextAction: "Order the parts list.",
  memoryDisclosure: [],
}

describe("validateDecisionBrief: guide", () => {
  test("accepts a maximal valid guide brief", () => {
    const brief = validateDecisionBrief(guideBrief)
    if (brief.mode !== "guide") throw new Error("expected guide mode")
    expect(brief.recommendation).toHaveLength(1)
    expect(brief.procedure).toHaveLength(2)
    expect(brief.background).toHaveLength(1)
  })

  test("rejects a guide with neither recommendation nor procedure", () => {
    const validate = (): void => {
      validateDecisionBrief(briefWith(guideBrief, { recommendation: [], procedure: [] }))
    }
    expect(validate).toThrow(ConsultationError)
  })

  test("accepts a guide with only a procedure and no recommendation", () => {
    const brief = validateDecisionBrief(briefWith(guideBrief, { recommendation: [] }))
    if (brief.mode !== "guide") throw new Error("expected guide mode")
    expect(brief.procedure.length).toBeGreaterThan(0)
  })

  test("accepts a guide with only a recommendation and no procedure", () => {
    const brief = validateDecisionBrief(briefWith(guideBrief, { procedure: [] }))
    if (brief.mode !== "guide") throw new Error("expected guide mode")
    expect(brief.recommendation.length).toBeGreaterThan(0)
  })

  test("rejects an inferred background point without a basis", () => {
    const validate = (): void => {
      validateDecisionBrief(
        briefWith(guideBrief, { background: [{ point: "This part is best.", status: "inferred" }] }),
      )
    }
    expect(validate).toThrow(ConsultationError)
  })

  test("rejects an inferred procedure step without a basis", () => {
    const validate = (): void => {
      validateDecisionBrief(
        briefWith(guideBrief, { procedure: [{ step: "Mount the cooler.", support: "inferred" }] }),
      )
    }
    expect(validate).toThrow(ConsultationError)
  })

  test("defaults a recommendation candidate intent to unknown when omitted", () => {
    const brief = validateDecisionBrief(
      briefWith(guideBrief, { recommendation: [{ option: "GPU", evidenceGrade: "high" }] }),
    )
    if (brief.mode !== "guide") throw new Error("expected guide mode")
    expect(brief.recommendation[0]?.intent).toBe("unknown")
  })

  test("rejects numeric confidence in a guide goal", () => {
    const validate = (): void => {
      validateDecisionBrief(briefWith(guideBrief, { goal: "A build that works 85% of the time" }))
    }
    expect(validate).toThrow("NUMERIC_CONFIDENCE")
  })

  test("rejects numeric confidence in a guide prerequisite", () => {
    const validate = (): void => {
      validateDecisionBrief(briefWith(guideBrief, { prerequisites: ["Success rate 85%"] }))
    }
    expect(validate).toThrow("NUMERIC_CONFIDENCE")
  })

  test("rejects numeric confidence in a guide background point", () => {
    const validate = (): void => {
      validateDecisionBrief(
        briefWith(guideBrief, { background: [{ point: "Works 85% of the time", status: "verified" }] }),
      )
    }
    expect(validate).toThrow("NUMERIC_CONFIDENCE")
  })

  test("rejects numeric confidence in a guide completion check", () => {
    const validate = (): void => {
      validateDecisionBrief(briefWith(guideBrief, { completionCheck: "Boots 85% of the time" }))
    }
    expect(validate).toThrow("NUMERIC_CONFIDENCE")
  })

  test("rejects numeric confidence in a guide recommendation option", () => {
    const validate = (): void => {
      validateDecisionBrief(
        briefWith(guideBrief, { recommendation: [{ option: "85% option", evidenceGrade: "high" }] }),
      )
    }
    expect(validate).toThrow("NUMERIC_CONFIDENCE")
  })

  test("rejects numeric confidence in a guide procedure step risk", () => {
    const validate = (): void => {
      validateDecisionBrief(
        briefWith(guideBrief, { procedure: [{ step: "Mount the cooler.", support: "verified", risk: "85% injury risk" }] }),
      )
    }
    expect(validate).toThrow("NUMERIC_CONFIDENCE")
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test packages/consultation-core/src/decision-brief.test.ts`
Expected: FAIL — a `mode: "guide"` input is rejected by the current 4-member union ("Invalid discriminator value" or `VALIDATION_FAILED`).

- [ ] **Step 3: Implement `GuideBackgroundPointSchema` and `GuideBriefSchema`**

In `packages/consultation-core/src/decision-brief.ts`, add after `ResearchBriefSchema` / its type export (after line 125):

```ts
export const GuideBackgroundPointSchema = z
  .object({
    point: z.string().min(1),
    status: EpistemicStatusSchema.optional(),
    basis: z.string().optional(),
  })
  .refine(
    (value) =>
      !(value.status === "inferred" || value.status === "unverifiable") ||
      (value.basis !== undefined && value.basis.length > 0),
    {
      message: "inferred/unverifiable background points must carry a basis",
      path: ["basis"],
    },
  )
export type GuideBackgroundPoint = z.infer<typeof GuideBackgroundPointSchema>

// NOTE: plain z.object, no top-level .refine — a ZodEffects cannot join the
// discriminated union. The >=1-section rule lives in validateDecisionBrief.
export const GuideBriefSchema = z.object({
  mode: z.literal("guide"),
  ...baseBriefShape,
  goal: z.string().min(1),
  suitedFor: z.string().optional(),
  prerequisites: z.array(z.string()).default([]),
  recommendation: z.array(SelectCandidateSchema).default([]),
  procedure: z.array(PlanStepSchema).default([]),
  background: z.array(GuideBackgroundPointSchema).default([]),
  completionCheck: z.string().optional(),
  assumptions: z.array(z.string()).default([]),
  residualUncertainty: z.string().optional(),
})
export type GuideBrief = z.infer<typeof GuideBriefSchema>
```

- [ ] **Step 4: Add `guide` to the discriminated union**

Change `DecisionBriefSchema` (lines 127-132) to include `GuideBriefSchema`:

```ts
export const DecisionBriefSchema = z.discriminatedUnion("mode", [
  SelectBriefSchema,
  VerifyBriefSchema,
  PlanBriefSchema,
  ResearchBriefSchema,
  GuideBriefSchema,
])
```

- [ ] **Step 5: Add the `guide` branch to `briefTexts`**

In `briefTexts` (lines 143-193), insert a `guide` branch before the final `else` (the research branch at line 183), so the chain becomes `select / verify / plan / guide / else(research)`:

```ts
  } else if (brief.mode === "guide") {
    texts.push(brief.goal, ...brief.assumptions, ...brief.prerequisites)
    if (brief.suitedFor !== undefined) texts.push(brief.suitedFor)
    if (brief.completionCheck !== undefined) texts.push(brief.completionCheck)
    if (brief.residualUncertainty !== undefined) texts.push(brief.residualUncertainty)
    for (const point of brief.background) {
      texts.push(point.point)
      if (point.basis !== undefined) texts.push(point.basis)
    }
    for (const candidate of brief.recommendation) {
      texts.push(candidate.option)
      if (candidate.suitedFor !== undefined) texts.push(candidate.suitedFor)
      if (candidate.trialAdvice !== undefined) texts.push(candidate.trialAdvice)
    }
    for (const step of brief.procedure) {
      texts.push(step.step, ...step.alternatives)
      if (step.basis !== undefined) texts.push(step.basis)
      if (step.risk !== undefined) texts.push(step.risk)
    }
  } else {
```

- [ ] **Step 6: Enforce the ≥1-section rule in `validateDecisionBrief`**

In `validateDecisionBrief` (lines 195-207), add the cross-field check immediately after `DecisionBriefSchema.parse(input)` and before the `briefTexts` loop:

```ts
export function validateDecisionBrief(input: unknown): DecisionBrief {
  try {
    const brief = DecisionBriefSchema.parse(input)
    if (brief.mode === "guide" && brief.recommendation.length === 0 && brief.procedure.length === 0) {
      throw new ConsultationError(ConsultationErrorCode.VALIDATION_FAILED)
    }
    for (const text of briefTexts(brief)) assertNoNumericConfidence(text)
    return brief
  } catch (error) {
    if (error instanceof ConsultationError) throw error
    if (error instanceof ZodError) {
      throw new ConsultationError(ConsultationErrorCode.VALIDATION_FAILED)
    }
    throw error
  }
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `bun test packages/consultation-core/src/decision-brief.test.ts`
Expected: PASS (all existing + 14 new guide tests).

- [ ] **Step 8: Run the full consultation-core suite and typecheck**

Run: `bun test packages/consultation-core && bun run typecheck`
Expected: PASS; typecheck clean (the `DecisionBrief` type gains a guide variant; `briefTexts` if/else-if/else remains exhaustive).

- [ ] **Step 9: Commit**

```bash
git add packages/consultation-core/src/decision-brief.ts packages/consultation-core/src/decision-brief.test.ts
git commit -m "Add the guide decision-brief schema and validation"
```

---

### Task 3: Add a guide routing eval case (C11)

**Files:**
- Modify: `evals/fixtures/consultation-cases.json` (append after the C10 object, line 91)

**Interfaces:**
- Consumes: Task 2 (`decision-brief.test.ts` is the deterministic backstop named in the rubric).

- [ ] **Step 1: Append the C11 case**

Add a comma after the C10 closing brace (line 91) and append:

```json
  {
    "id": "C11",
    "title": "A composite end-to-end request routes to the guide mode",
    "given": "A user asks for an operational package that fuses a recommendation, a procedure, and background — e.g. \"给我一份装机攻略\" or \"a complete guide to renovating a kitchen\" — where at least a recommendation or a procedure is required.",
    "when": "The consultant detects the mode",
    "then": "The consultant routes to the guide mode (not plan or research), and the deliverable carries a recommendation and/or a procedure plus background and a next action.",
    "grading": "model",
    "notes": "Rubric: Does a composite 攻略 request route to guide and produce a recommendation and/or procedure section plus background and a next action? Deterministic backstop: GuideBriefSchema validates a guide brief and validateDecisionBrief rejects a guide with neither recommendation nor procedure (packages/consultation-core/src/decision-brief.test.ts)."
  }
```

- [ ] **Step 2: Run the evals runner and confirm C11 prints as MANUAL**

Run: `bun run evals/run-evals.ts`
Expected: exits 0; C11 appears under "MODEL-GRADED" with `status: MANUAL (model-graded)`; summary shows `model-graded cases: 9` (was 8). No runner change is needed (model cases are intentionally absent from `DETERMINISTIC_TEST_MAP`).

- [ ] **Step 3: Commit**

```bash
git add evals/fixtures/consultation-cases.json
git commit -m "Add a guide routing evaluation case"
```

---

### Task 4: Update the consultation skill (`SKILL.md`)

**Files:**
- Modify: `assets/skills/consultation/SKILL.md`

**Interfaces:** none (prompt text). Keep the mode list and templates consistent with `consultant.md` (Task 5) and `README.md` (Task 6).

- [ ] **Step 1: Add `guide` to the front-matter description**

Edit the `description:` (line 3) — change `four modes (select / verify / plan / research)` to `five modes (select / verify / plan / research / guide)`, and append to the load-triggers: `a composite end-to-end operational guide (攻略, how do I get started with X, X 入门)`.

- [ ] **Step 2: Add `guide` to "When to Use" (line 14)**

Append a clause: `a composite operational guide that fuses a recommendation, a procedure, and background for an end-to-end goal (攻略, X入门, guide to X) (guide)`.

- [ ] **Step 3: Add the `guide` mode bullet under "Mode" (after the `research` bullet, line 24)**

```markdown
  - `guide`: produce a composite operational package — a curated recommendation, an actionable procedure, and the background/pitfalls — for an end-to-end goal (攻略, "X入门", "guide to X", "how do I get started with X"). Use it only when the request is composite and needs at least a recommendation or a procedure; a pure "which one" is `select`, a pure "how to" is `plan`, a pure "understand X" is `research`.
```

- [ ] **Step 4: Add a guide workflow note to the numbered Workflow (after step 10's mode-brief mention)**

Append after the `research`-mode paragraph (line 42):

```markdown
For `guide` mode, decompose claims across all three facets (recommendation, procedure, background) and run the same explore -> analyze -> critique loop; because the guide contains a recommendation, run the verifier's intent audit at standard and deep tiers, and have the critic apply the plan robustness review to the procedure section. Deliver the operational playbook template below.
```

- [ ] **Step 5: Add the guide output template (after the research template, before "Always end with")**

````markdown
### guide: operational playbook

```
# <goal>攻略

一句话结论: <what this guide gets you to + the single most important move/pick>.

适合谁 / 不适合谁: <...>.  前置条件: <what to have ready before starting>.

## 推荐清单（选什么）
| 选项 | 证据等级 | 污染提示 | 适合 | 试用建议 |

## 操作流程（怎么做）
| 步骤 | 依据 | 信心 | 风险 | 替代 |

## 背景与避坑（要懂什么）
- <point>
避坑: <...>

## 验收标准
<what "done" looks like>

证据可信度 + 稳定性.  假设: <...>.  残留不确定性: <...>.
<details><summary>证据、分歧与来源（点开）</summary> ... </details>

Next: <first concrete action>.
```

Keep only the sections that carry content; a guide must carry at least a recommendation or a procedure.
````

- [ ] **Step 6: Commit**

```bash
git add assets/skills/consultation/SKILL.md
git commit -m "Document the guide mode in the consultation skill"
```

---

### Task 5: Update the consultant agent prompt (`consultant.md`)

**Files:**
- Modify: `assets/agents/consultant.md`

**Interfaces:** keep consistent with `SKILL.md` (Task 4) and `README.md` (Task 6). The mode count "four" appears in the Role paragraph (line 5), the §Consultation Modes intro, and README/architecture.

- [ ] **Step 1: Update the Role paragraph (line 5)**

Change `detect one of four modes and deliver its contract: select ... or research ...` to `detect one of five modes and deliver its contract: select (choose among candidates), verify (verdict on a claim), plan (an actionable plan), guide (a composite operational playbook), or research (understand a topic deeply, a readable research report)`.

- [ ] **Step 2: Add the guide bullet to §Consultation Modes (after the research bullet, line 18)**

```markdown
- **guide** — produce a composite operational package (a curated recommendation + an actionable procedure + the background/pitfalls) for an end-to-end goal (攻略, "X入门", "guide to X"). Use it only when the request is composite and carries at least a recommendation or a procedure; otherwise route to select / plan / research. Deliver the operational playbook: bottom line, suitability and prerequisites, a recommendation table, a procedure table, background/pitfalls, a completion check, confidence and stability, and the first concrete action.
```

- [ ] **Step 3: Note guide tier/team behavior in §Consultation Tiers**

In the **Standard** tier (line 37) add guide to the comparison/recommendation trigger list; in the **Deep** tier (line 46-55) add that a broad composite `guide` is a deep trigger and runs the full team including the verifier (because it contains a recommendation). Add one line: `A guide is composite and synthesis-heavy, so it routes to standard or deep, never fast.`

- [ ] **Step 4: Add the guide bullet to §Output Contract → Complex Consultation (after the research bullet, line 145)**

```markdown
- **guide**: an operational playbook — bottom line first, suitability and prerequisites, a recommendation table (option, evidence grade, contamination note, suits, trial advice), a procedure table (step, support, confidence, basis, risk, alternatives), background and pitfalls, a completion check, confidence and stability, with evidence and disagreements folded behind a details disclosure, and the first concrete action.
```

- [ ] **Step 5: Commit**

```bash
git add assets/agents/consultant.md
git commit -m "Document the guide mode in the consultant prompt"
```

---

### Task 6: Update `README.md`

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the intro paragraph (line 5)**

Change `four modes: select ... and research ...` to `five modes: select (choose among candidates), verify (verdict on a claim), plan (an actionable plan), guide (a composite operational playbook), and research (understand a topic deeply, delivered as a readable report)`.

- [ ] **Step 2: Update the routing sentence and add a guide row to the modes table (lines 11-18)**

Change `routes to one of four modes` to `routes to one of five modes`, and add a table row after the `plan` row:

```markdown
| `guide` | a composite end-to-end operational package — 攻略、X入门、guide to X | an operational playbook: bottom line, suitability + prerequisites, a recommendation table, a procedure table, background/pitfalls, a completion check, and a next step |
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Document the guide mode in the README"
```

---

### Task 7: Update `docs/architecture.md`

**Files:**
- Modify: `docs/architecture.md`

- [ ] **Step 1: §1 Executive Decision (line 9)** — change `four modes (select, verify, plan, research)` to `five modes (select, verify, plan, research, guide)`.

- [ ] **Step 2: §5.1 Consultant Agent (line 95)** — change `one of four modes — select, verify, plan, or research` to `one of five modes — select, verify, plan, research, or guide`.

- [ ] **Step 3: §6 Consultation Workflow mermaid (line 185)** — change `MODE[Detect Mode: select / verify / plan / research]` to `MODE[Detect Mode: select / verify / plan / research / guide]`.

- [ ] **Step 4: §16 User-Facing Output Contract (after the research bullet, line 598)** — add:

```markdown
- **guide** — a composite operational playbook: bottom line first, suitability and prerequisites, a recommendation table (option, evidence grade, contamination note, suits, trial advice), a procedure table (step, support, confidence, basis, risk, alternatives), background and pitfalls, a completion check, confidence, stability, evidence and disagreements folded behind a disclosure, and the first concrete action. Carries at least a recommendation or a procedure.
```

- [ ] **Step 5: §17.1 Consultation Evaluation Cases (after the deep-consultation bullet, line 615)** — add:

```markdown
- a composite end-to-end request routes to the guide mode and carries at least a recommendation or a procedure;
```

- [ ] **Step 6: Commit**

```bash
git add docs/architecture.md
git commit -m "Document the guide mode in the architecture spec"
```

---

### Task 8: Repo gate — full verification

**Files:** none modified (verification only).

- [ ] **Step 1: Full test suite**

Run: `bun test`
Expected: PASS across all packages (consultation-core gains the new enum + guide brief tests).

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: clean, no errors.

- [ ] **Step 3: Build and install the packaged bundle**

Run: `bun run install:local`
Expected: builds `dist/`, stages into the install prefix, verifies the result, prints the plugin entry.

- [ ] **Step 4: Prove the installed artifact**

Run: `CONSULTATION_PLUGIN_ENTRY=~/.local/share/consultation-agent-plugin/dist/index.js bun run integration`
Expected: integration proof passes (skips cleanly only if `opencode` is absent).

- [ ] **Step 5: Evals runner sanity**

Run: `bun run evals/run-evals.ts`
Expected: exits 0; C11 present under MODEL-GRADED; summary `model-graded cases: 9`.

---

## Self-Review notes (already applied)

- **Spec coverage:** enum (T1), schema+validation (T2), routing eval (T3), SKILL/consultant/README/architecture docs (T4-T7), repo gate (T8). The `ConsultationMode` scope check is T0. Report-format decisions for the existing four modes are "unchanged", so no task alters them.
- **Placeholder scan:** every code/test step contains the full content; no TBD/TODO.
- **Type consistency:** `GuideBriefSchema` field names (`goal`, `suitedFor`, `prerequisites`, `recommendation`, `procedure`, `background`, `completionCheck`, `assumptions`, `residualUncertainty`) are used identically in the schema (T2), the test fixture (T2), and `briefTexts` (T2). `GuideBackgroundPointSchema` uses `point`/`status`/`basis` consistently.
- **Deviation from spec (intentional):** the ≥1-section rule is enforced in `validateDecisionBrief` as a post-parse check, not a top-level `.refine` on `GuideBriefSchema`, because a `.refine` returns `ZodEffects` which `z.discriminatedUnion` rejects. The spec's §4.2 code block should be read with this correction.
