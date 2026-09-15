# Design: `guide` — a fifth, general-purpose consultation mode

Date: 2026-09-15
Status: Approved (all decision points confirmed by user: "全部按推荐")
Scope: additive, backward-compatible. No behavior change to the existing four modes.

## 1. Context and goal

The consultant today routes every question to exactly one of four modes — `select`
(choose among candidates), `verify` (verdict on a claim), `plan` (an actionable
plan), `research` (understand a topic). This "one question → one mode" design
under-delivers a whole class of real requests: the **composite operational
package**, where the user wants to accomplish a goal end-to-end and needs a
curated recommendation, an actionable procedure, and the background/pitfalls
fused into one deliverable.

The canonical example is the Chinese content genre **攻略** ("guide"): travel
guides, renovation guides, PC-build guides, exam-prep guides, visa/immigration
guides, parenting guides, fitness-starter guides, job-hunting guides, car-buying
guides. Today such a request is forced into a single mode (usually `plan` or
`research`) and loses the other dimensions, or triggers a clarifying question.

Goal: add a fifth, **general-purpose** mode `guide` that owns this composite type
— not travel-specific, but any "everything I need to get X done" consultation.

## 2. Approved decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 0 | General-purpose definition | `guide` = composite operational package (recommendation + procedure + background) for an end-to-end goal | Fills the gap none of select/plan/research covers alone; not travel-specific |
| 1 | Implementation shape | **First-class mode** with its own `GuideBriefSchema` that reuses existing sub-schemas | Keeps the architecture's core invariant "one question → one mode → one validated brief" (see `enums.ts`, `decision-brief.ts`, `docs/architecture.md` §8/§16). Orchestrating three sub-briefs would break that invariant with no clean way to merge confidence/conclusion/nextAction. Sub-schemas are reused, not rewritten. |
| 2 | Mode merge/split | **Keep 5 modes; no merge, no split** | `verify` ≠ `select` (per-claim verdict table, refuted status, supporting-vs-opposing, distinct high-frequency task). `guide` ≠ `research`/`plan` (different orientation: understanding vs procedure vs composite). `select`/`research` already span their range. |
| 3 | Guide internal structure | **Variable sections**: `recommendation` / `procedure` / `background` each optional, but ≥1 of `recommendation`/`procedure` required | How-to best practice: keep only sections that add value; a rigid template erodes trust. A PC-build guide is recommendation+procedure heavy, background light; a job-hunting guide is procedure heavy. |
| 4 | Report format | Existing four unchanged; **`guide` gets a "操作手册 / operational playbook" form** (readable container + structured tables per section) | Grounded in research (§7). Existing four already fit their type. A guide must be both read and followed, so it is a hybrid. |
| 5 | Tier / team / outcome | `guide` defaults to **standard/deep**, runs the **full team incl. verifier** (it contains a recommendation), and the **outcome loop applies** (like select+plan) | Contains a recommendation → needs the intent audit; composite/broad → not fast tier; contains a decision → register a pending outcome. |
| 6 | Change scope / compatibility | **Purely additive, backward-compatible**; follow the repo change checklist | No existing mode behavior changes. |

## 3. Mode taxonomy after the change

Five modes, one distinct deliverable each:

| Mode | Deliverable | Question it answers |
|------|-------------|---------------------|
| `select` | ranked candidate list with grades | which one? |
| `verify` | verdict + per-claim table | is it true? |
| `plan` | step plan | how do I do it? |
| `research` | readable report | what is it / understand it |
| `guide` | composite operational playbook | everything I need to get X done |

### Routing rule (prevents guide from stealing select/plan/research)

`guide` applies only when the question is **composite** — the user wants an
end-to-end operational package — **and** at least one of {recommendation,
procedure} is materially present. Otherwise fall back:

- purely "which one" → `select`
- purely "how to do X" (procedure only, no recommendation/background) → `plan`
- purely "understand X" → `research`
- genuinely ambiguous → ask one clarifying question (existing rule, unchanged)

Trigger signals for `guide`: "攻略", "X入门", "X 全流程", "手把手教我X",
"guide to X", "how do I get started with X", "X 完全指南", and any request that
fuses "recommend + how-to + what-to-know".

## 4. Output contract (code)

### 4.1 Mode enum (`packages/consultation-core/src/enums.ts`)

Add `"guide"` to `ConsultationModeSchema` and document it in the leading comment:

```ts
export const ConsultationModeSchema = z.enum(["select", "verify", "plan", "research", "guide"])
```

Doc comment addition:
`- guide: composite operational package (recommendation + procedure + background) for an end-to-end goal — produces an operational playbook, not a single decision or a pure understanding report.`

### 4.2 `GuideBriefSchema` (`packages/consultation-core/src/decision-brief.ts`)

Reuses `SelectCandidateSchema`, `PlanStepSchema`, and the shared
`baseBriefShape`. Background points apply the same basis-required rule as the
existing `basisRefinement` helper, but inline because their `status` is optional
(the helper's signature expects a required `EpistemicStatus`). New code:

```ts
const GuideBackgroundPointSchema = z
  .object({
    point: z.string().min(1),
    status: EpistemicStatusSchema.optional(),
    basis: z.string().optional(),
  })
  .refine(
    (v) => !(v.status === "inferred" || v.status === "unverifiable") ||
      (v.basis !== undefined && v.basis.length > 0),
    { message: "inferred/unverifiable background points must carry a basis", path: ["basis"] },
  )
export type GuideBackgroundPoint = z.infer<typeof GuideBackgroundPointSchema>

export const GuideBriefSchema = z
  .object({
    mode: z.literal("guide"),
    ...baseBriefShape, // conclusion, confidence, stability, verifiedFacts, synthesis, sources, nextAction, memoryDisclosure
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
  .refine((v) => v.recommendation.length > 0 || v.procedure.length > 0, {
    message: "guide must carry a recommendation or a procedure (else it is select or plan)",
    path: ["recommendation"],
  })
export type GuideBrief = z.infer<typeof GuideBriefSchema>
```

Add `GuideBriefSchema` to the `DecisionBriefSchema` discriminated union, and add
a `guide` branch to `briefTexts` (so `assertNoNumericConfidence` scans every
user-visible guide string): base texts + `goal`, `suitedFor`, `prerequisites`,
`completionCheck`, `assumptions`, `residualUncertainty`, each background
`point`/`basis`, each candidate (`option`, `suitedFor`, `trialAdvice`), and each
step (`step`, `alternatives`, `basis`, `risk`).

Design notes:
- Epistemic rigor lives where it already lives: `verifiedFacts`/`synthesis`
  separate fact from inference; candidates carry `evidenceGrade`; steps carry
  `support` status; background points optionally carry `status`+`basis`.
- `recommendation` reuses `SelectCandidateSchema` (option, evidenceGrade, intent,
  suitedFor, trialAdvice) so the verifier's `intent` annotation flows straight in.
- `procedure` reuses `PlanStepSchema` (step, support, basis, risk, confidence,
  alternatives) including its existing basis refinement, so plan-repair applies.

## 5. Team orchestration, tier, and memory

- **Loop**: `guide` runs the same `explore → analyze → critique` loop on
  decomposed claims (claims now span the recommendation, procedure, and
  background facets). No change to `team.ts` mechanics.
- **Verifier**: because `guide` contains a recommendation, the verifier's intent
  audit runs at standard/deep (same rule as select/verify). Contamination notes
  attach to the recommendation section.
- **Critic**: runs both the counter-evidence pass and, on the `procedure`
  section, the existing plan-robustness review (`plan-repair.ts` applies as-is).
- **Tier**: `guide` is composite and synthesis-heavy, so it routes to standard or
  deep, not fast. The tier router is mode-agnostic (driven by the risk/complexity
  flags the consultant sets) — no `tier-router.ts` change; the consultant sets
  `synthesisDominated` for guide. Documented in the skill/prompt.
- **Memory / outcome loop**: a `guide` consultation contains a decision, so it
  registers a pending outcome exactly like `select`/`plan` ("how did that <goal>
  work out?"). The canonical memory entities (`Decision`, `Claim`, `Evidence`)
  are mode-agnostic, so **no memory-core or memory-mcp schema change is
  expected**. Verification step during implementation: grep for `ConsultationMode`
  across `memory-core`, `memory-mcp`, and `opencode-adapter`; extend only if a
  reference actually exists.

## 6. Report format

Principle: pick the form that fits the deliverable type. Grounded in a search
review of established conventions (decision briefs and how-to/playbooks).

### 6.1 Existing four modes — unchanged

| Mode | Form | Basis |
|------|------|-------|
| `select` | decision brief: one-line recommendation + candidate comparison table + trade-offs + confidence/stability + next step | SOCCR / one-page decision memo (Situation→Options→Criteria→Comparison→Recommendation) |
| `verify` | verdict card: true/false/unverifiable + per-claim verdict table + supporting vs opposing | fact-check verdict convention |
| `plan` | step brief: goal+suitability + step table + robustness review + assumptions | procedure/plan convention |
| `research` | readable report: BLUF + key points + implications, evidence folded in `<details>` | research-report convention |

### 6.2 `guide` — new "操作手册 / operational playbook" form

A hybrid: a research-style readable container (BLUF, plain language, folded
evidence) with select/plan structured tables inside each section. Follows the
how-to structure (direct answer → prerequisites → recommended materials →
ordered steps → pitfalls → verification → next step), keeping only sections that
carry content.

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

## 7. Files to change

Code:
- `packages/consultation-core/src/enums.ts` — add `"guide"` + doc comment.
- `packages/consultation-core/src/decision-brief.ts` — `GuideBackgroundPointSchema`,
  `GuideBriefSchema`, union entry, `briefTexts` guide branch.
- `packages/consultation-core/src/decision-brief.test.ts` — tests below.
- `evals/fixtures/consultation-cases.json` — guide routing + composite-output cases.

Docs / prompts:
- `assets/skills/consultation/SKILL.md` — mode definition, routing rule, guide
  workflow step, guide output template, "when to use".
- `assets/agents/consultant.md` — mode list, guide tier/team behavior, guide
  output contract.
- `README.md` — five-mode table + routing line.
- `docs/architecture.md` — §1 (five modes), §5.1, §6 workflow mermaid (add guide
  to mode detection), §16 output contract (guide), §17 eval cases (guide).

Verification:
- grep `ConsultationMode` across `memory-core`, `memory-mcp`, `opencode-adapter`;
  extend only if referenced (expected: no change, they key on `Tier`).
- Repo change checklist (`AGENTS.md`): `bun test` → `bun run typecheck` →
  `bun run install:local` → `CONSULTATION_PLUGIN_ENTRY=... bun run integration`.

## 8. Testing

Add to `decision-brief.test.ts`:
- a valid `guide` brief (recommendation + procedure + background) passes validation;
- the ≥1-of-`recommendation`/`procedure` refinement rejects an empty-sections guide;
- a background point with `status: "inferred"` and no `basis` is rejected; with a
  `basis` it passes;
- a `procedure` step that is `inferred` without `basis` is rejected (reused rule);
- a numeric percentage anywhere in guide text throws `NUMERIC_CONFIDENCE`;
- the discriminated union routes `mode: "guide"` to `GuideBriefSchema`.

Add to `evals/fixtures/consultation-cases.json`:
- a composite "攻略" request routes to `guide` (not `plan`/`research`);
- a guide output carries at least a recommendation or a procedure and ends with a
  next action.

## 9. Out of scope

- No merge/split of the existing four modes.
- No change to memory-core / memory-mcp schemas (mode-agnostic), pending the
  grep verification above.
- No new subagent role; guide reuses explorer/analyst/critic/verifier.
- No tier-router code change (mode-agnostic input flags).
- No separate "guide agent"; guide is a mode of the consultant.
