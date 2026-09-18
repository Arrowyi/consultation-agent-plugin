# `author` Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a portable sixth `author` consultation mode for tutorial, architecture-analysis, and technical-explanation documents, including audience-aware writing, optional multi-file delivery, and proportionate source/build/runtime verification.

**Architecture:** `author` joins the existing one-mode/one-brief discriminated union. Focused author child schemas live in a new core module; `decision-brief.ts` composes them with `baseBriefShape` and validates delivery cross-fields. A plugin-owned read-only `writer` role supplies a writing blueprint, while the consultant primary remains responsible for file writes and executable verification. All behavior and assets ship with this repository and pass an isolated installed-artifact integration proof without Janus, OMO, global agents, or developer-local configuration.

**Tech Stack:** Bun >= 1.1, TypeScript strict, zod ^3.25, `bun:test`, OpenCode plugin API. No new runtime dependencies.

## Global Constraints

- Follow `docs/superpowers/specs/2026-09-18-author-mode-design.md` exactly.
- Existing `select`, `verify`, `plan`, `research`, and `guide` behavior remains unchanged.
- Core packages remain harness-neutral: no OpenCode tool names, provider-specific models, filesystem calls, or local paths in core types.
- Runtime behavior must not reference Janus, Sisyphus, OMO, host category names, user-installed skills, `~/.config/opencode/agents`, or the development checkout.
- `AuthorBriefSchema` remains a plain `z.object`; cross-field delivery checks belong in `validateDecisionBrief`.
- The consultant asks for audience when absent, asks delivery shape/destination every time, and waits once for outline approval before large-document authoring.
- `writer` is optional, plugin-owned, and registered with both `edit: deny` and `bash: deny`.
- `writer_model` defaults to `deepseek/deepseek-v4-pro` and is overrideable through validated plugin config; no model fallback chain is encoded.
- Existing custom `tier_role_caps` without `writer` must continue to parse; those custom matrices resolve `writer` to 0 unless explicitly supplied.
- Requested file output uses the caller-approved destination; no product default hard-codes `userdoc/` or `docs/`.
- Test framework is `bun:test`; implementation follows red-green-refactor.
- Before completion run: `bun test`, `bun run typecheck`, `bun run install:local`, installed-artifact `bun run integration`, and `bun run evals/run-evals.ts`.
- Do not edit generated `dist/` or the install prefix by hand.
- Do not touch the user's existing `userdoc/jetpack-compose-internals-composer.md`.
- Git commits are performed only when the user explicitly authorizes commits. If authorized, prefix every git command with `GIT_MASTER=1` and use the repository's imperative plain-message style.

## File Map

Core contracts:

- Create `packages/consultation-core/src/author-contracts.ts` — profile, delivery, verification, section, and load-bearing-claim schemas.
- Create `packages/consultation-core/src/author-contracts.test.ts` — focused child-schema tests.
- Modify `packages/consultation-core/src/enums.ts` and `enums.test.ts` — add `author` mode.
- Modify `packages/consultation-core/src/decision-brief.ts` and `decision-brief.test.ts` — compose and validate final `AuthorBrief`.
- Modify `packages/consultation-core/src/team.ts` and `team.test.ts` — add writer role/caps without changing phase transitions.

OpenCode adapter:

- Modify `packages/opencode-adapter/src/plugin-config.ts` and tests — writer fields, model resolution, backward-compatible caps.
- Modify `packages/opencode-adapter/src/dispatch-tool.ts` and tests — dispatch writer.
- Modify `packages/opencode-adapter/src/agent-registration.ts` and tests — register writer with edit/shell denied and inject runtime bindings.
- Modify `packages/opencode-adapter/src/plugin.ts` and tests — conditionally register writer.
- Create `assets/agents/writer.md` — portable writing-blueprint role prompt.

Prompts, evals, packaging, and docs:

- Modify `assets/agents/consultant.md` and `assets/skills/consultation/SKILL.md` — routing and complete author workflow.
- Modify `evals/fixtures/consultation-cases.json` — author routing/outline/verification cases.
- Modify `script/install-local.ts` — require packaged writer asset.
- Modify `script/integration-opencode.ts` — assert writer registration and scrub developer-local env overrides.
- Modify `README.md`, `docs/architecture.md`, and `docs/deployment.md` — public behavior and configuration.

---

### Task 0: Confirm impact boundaries and clean baseline

**Files:** none modified.

**Interfaces:** none.

- [ ] **Step 1: Confirm mode references outside consultation-core**

Run:

```bash
rg -n "ConsultationMode" packages/memory-core packages/memory-mcp packages/opencode-adapter
```

Expected: no matches. If a match exists, stop and add the affected schema/test to Task 1 before editing; do not assume memory is mode-neutral.

- [ ] **Step 2: Confirm local-agent names are absent from runtime source**

Run:

```bash
rg -n "Janus|Sisyphus|OMO|task\(category|~/.config/opencode/agents|~/.omo" packages assets script
```

Expected: no runtime dependency matches. Documentation prose may mention portability, but runtime source and assets must not require these names.

- [ ] **Step 3: Record the pre-existing worktree state**

Run:

```bash
GIT_MASTER=1 git status --short
```

Expected: note the existing user-owned `userdoc/jetpack-compose-internals-composer.md` modification and the approved design/plan documents. Do not revert or stage unrelated changes.

---

### Task 1: Add the author mode and focused author child schemas

**Files:**

- Create: `packages/consultation-core/src/author-contracts.ts`
- Create: `packages/consultation-core/src/author-contracts.test.ts`
- Modify: `packages/consultation-core/src/enums.ts:16-27`
- Modify: `packages/consultation-core/src/enums.test.ts`

**Interfaces:**

- Produces `AuthorProfileSchema`, `AuthorDeliverySchema`, `AuthorVerificationSchema`, `AuthorSectionSchema`, `AuthorClaimSchema` and inferred types.
- Produces `ConsultationMode` variant `"author"` consumed by Task 2.

- [ ] **Step 1: Write failing enum and contract tests**

Add an exact mode-list assertion to `enums.test.ts`:

```ts
test("ConsultationModeSchema has the six public modes", () => {
  expect(ConsultationModeSchema.options).toEqual([
    "select",
    "verify",
    "plan",
    "research",
    "guide",
    "author",
  ])
})
```

Create `author-contracts.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import {
  AuthorClaimSchema,
  AuthorDeliverySchema,
  AuthorProfileSchema,
  AuthorSectionSchema,
  AuthorVerificationSchema,
} from "./author-contracts.ts"

describe("author contracts", () => {
  test("accepts every author control value", () => {
    expect(AuthorProfileSchema.options).toEqual(["tutorial", "architecture", "explanation"])
    expect(AuthorDeliverySchema.options).toEqual(["inline", "single_file", "multi_file"])
    expect(AuthorVerificationSchema.options).toEqual(["light", "targeted", "strict"])
  })

  test("accepts a complete section manifest entry", () => {
    const section = AuthorSectionSchema.parse({
      id: "structured-concurrency",
      title: "Structured concurrency",
      purpose: "Explain ownership and cancellation propagation.",
      file: "03-structured-concurrency.md",
      learningObjectives: ["Trace cancellation through a coroutine tree."],
      prerequisites: ["Suspension and continuations"],
      verificationTargets: ["Cancellation reaches child jobs."],
    })
    expect(section.file).toBe("03-structured-concurrency.md")
  })

  test("rejects an inferred claim without a basis", () => {
    expect(() =>
      AuthorClaimSchema.parse({
        claim: "Cancellation always reaches detached work.",
        sectionIds: ["structured-concurrency"],
        status: "inferred",
        verificationMethod: "Source inspection",
      }),
    ).toThrow()
  })

  test("accepts an inferred claim with a basis", () => {
    const claim = AuthorClaimSchema.parse({
      claim: "Cancellation propagates through the parent Job hierarchy.",
      sectionIds: ["structured-concurrency"],
      status: "inferred",
      basis: "Inferred from Job parent-child linkage in the inspected source.",
      verificationMethod: "Source inspection",
    })
    expect(claim.status).toBe("inferred")
  })
})
```

- [ ] **Step 2: Run tests and verify red state**

Run:

```bash
bun test packages/consultation-core/src/enums.test.ts packages/consultation-core/src/author-contracts.test.ts
```

Expected: FAIL because `author-contracts.ts` does not exist and the enum has five modes.

- [ ] **Step 3: Implement the child schemas**

Create `author-contracts.ts`:

```ts
import { z } from "zod"
import { EpistemicStatusSchema } from "./enums.ts"

export const AuthorProfileSchema = z.enum(["tutorial", "architecture", "explanation"])
export type AuthorProfile = z.infer<typeof AuthorProfileSchema>

export const AuthorDeliverySchema = z.enum(["inline", "single_file", "multi_file"])
export type AuthorDelivery = z.infer<typeof AuthorDeliverySchema>

export const AuthorVerificationSchema = z.enum(["light", "targeted", "strict"])
export type AuthorVerification = z.infer<typeof AuthorVerificationSchema>

export const AuthorSectionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  purpose: z.string().min(1),
  file: z.string().min(1).optional(),
  learningObjectives: z.array(z.string().min(1)).default([]),
  prerequisites: z.array(z.string().min(1)).default([]),
  verificationTargets: z.array(z.string().min(1)).default([]),
})
export type AuthorSection = z.infer<typeof AuthorSectionSchema>

export const AuthorClaimSchema = z
  .object({
    claim: z.string().min(1),
    sectionIds: z.array(z.string().min(1)).min(1),
    status: EpistemicStatusSchema,
    basis: z.string().min(1).optional(),
    verificationMethod: z.string().min(1),
  })
  .refine(
    (value) =>
      !(value.status === "inferred" || value.status === "unverifiable") ||
      value.basis !== undefined,
    { message: "inferred/unverifiable author claims must carry a basis", path: ["basis"] },
  )
export type AuthorClaim = z.infer<typeof AuthorClaimSchema>
```

- [ ] **Step 4: Add `author` to the public mode enum**

Append an `author` doc-comment bullet and change the enum to:

```ts
export const ConsultationModeSchema = z.enum([
  "select",
  "verify",
  "plan",
  "research",
  "guide",
  "author",
])
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
bun test packages/consultation-core/src/enums.test.ts packages/consultation-core/src/author-contracts.test.ts
```

Expected: PASS.

- [ ] **Step 6: Create an authorized checkpoint**

If commits were explicitly authorized:

```bash
GIT_MASTER=1 git add packages/consultation-core/src/enums.ts packages/consultation-core/src/enums.test.ts packages/consultation-core/src/author-contracts.ts packages/consultation-core/src/author-contracts.test.ts
GIT_MASTER=1 git commit -m "Add author mode core contracts"
```

Otherwise, leave the verified changes unstaged and continue.

---

### Task 2: Compose and validate the final AuthorBrief

**Files:**

- Modify: `packages/consultation-core/src/decision-brief.ts:1-265`
- Modify: `packages/consultation-core/src/decision-brief.test.ts`

**Interfaces:**

- Consumes Task 1 author schemas.
- Produces `AuthorBriefSchema`, `AuthorBrief`, and final-delivery cross-field validation.

- [ ] **Step 1: Add a failing AuthorBrief fixture and tests**

Add this fixture and describe block to `decision-brief.test.ts`:

```ts
const authorBrief = {
  mode: "author",
  conclusion: "The approved tutorial was written and its load-bearing examples were verified.",
  profile: "tutorial",
  audience: "Kotlin developers new to coroutines",
  goal: "Teach structured concurrency from mental model to tested examples.",
  delivery: "multi_file",
  verification: "targeted",
  styleSummary: "Progressive, example-led, and explicit about public APIs versus internals.",
  outline: [
    {
      id: "index",
      title: "Course map",
      purpose: "Describe audience, scope, and reading order.",
      file: "README.md",
    },
    {
      id: "structured-concurrency",
      title: "Structured concurrency",
      purpose: "Teach ownership and cancellation propagation.",
      file: "03-structured-concurrency.md",
      verificationTargets: ["Compile and run cancellation example."],
    },
  ],
  loadBearingClaims: [
    {
      claim: "A parent Job cancellation propagates to its children.",
      sectionIds: ["structured-concurrency"],
      status: "verified",
      verificationMethod: "Official API docs and executable example",
    },
  ],
  artifactPaths: ["README.md", "03-structured-concurrency.md"],
  assumptions: ["Kotlin 2.x and kotlinx.coroutines are available."],
  residualUncertainty: [],
  confidence: "high",
  stability: "conditional",
  verifiedFacts: ["The representative cancellation example compiled and ran."],
  synthesis: ["The tutorial separates stable API behavior from runtime internals."],
  sources: [{ title: "kotlinx.coroutines API", grade: "high" }],
  nextAction: "Review the course map and begin with the mental-model chapter.",
  memoryDisclosure: [],
}

describe("validateDecisionBrief: author", () => {
  test("accepts a valid multi-file final brief", () => {
    const brief = validateDecisionBrief(authorBrief)
    if (brief.mode !== "author") throw new Error("expected author mode")
    expect(brief.artifactPaths).toHaveLength(2)
  })

  test("rejects inline delivery with artifact paths", () => {
    expect(() =>
      validateDecisionBrief({ ...authorBrief, delivery: "inline", artifactPaths: ["README.md"] }),
    ).toThrow(ConsultationError)
  })

  test("rejects multi-file delivery with only one section", () => {
    expect(() =>
      validateDecisionBrief({
        ...authorBrief,
        outline: [authorBrief.outline[0]],
        artifactPaths: ["README.md"],
      }),
    ).toThrow(ConsultationError)
  })

  test("rejects numeric confidence in author text", () => {
    expect(() =>
      validateDecisionBrief({ ...authorBrief, styleSummary: "Examples are 95% reliable." }),
    ).toThrow("NUMERIC_CONFIDENCE")
  })
})
```

- [ ] **Step 2: Verify the tests fail**

Run:

```bash
bun test packages/consultation-core/src/decision-brief.test.ts
```

Expected: FAIL because the discriminated union rejects `mode: "author"`.

- [ ] **Step 3: Compose AuthorBriefSchema and add it to the union**

Import the Task 1 schemas and add after `GuideBriefSchema`:

```ts
export const AuthorBriefSchema = z.object({
  mode: z.literal("author"),
  ...baseBriefShape,
  profile: AuthorProfileSchema,
  audience: z.string().min(1),
  goal: z.string().min(1),
  delivery: AuthorDeliverySchema,
  verification: AuthorVerificationSchema,
  styleSummary: z.string().min(1),
  outline: z.array(AuthorSectionSchema).min(1),
  loadBearingClaims: z.array(AuthorClaimSchema).default([]),
  artifactPaths: z.array(z.string().min(1)).default([]),
  assumptions: z.array(z.string().min(1)).default([]),
  residualUncertainty: z.array(z.string().min(1)).default([]),
})
export type AuthorBrief = z.infer<typeof AuthorBriefSchema>
```

Append `AuthorBriefSchema` to `DecisionBriefSchema`.

- [ ] **Step 4: Add the author text scan branch**

Insert before the final research `else` in `briefTexts`:

```ts
  } else if (brief.mode === "author") {
    texts.push(
      brief.audience,
      brief.goal,
      brief.styleSummary,
      ...brief.artifactPaths,
      ...brief.assumptions,
      ...brief.residualUncertainty,
    )
    for (const section of brief.outline) {
      texts.push(
        section.id,
        section.title,
        section.purpose,
        ...section.learningObjectives,
        ...section.prerequisites,
        ...section.verificationTargets,
      )
      if (section.file !== undefined) texts.push(section.file)
    }
    for (const claim of brief.loadBearingClaims) {
      texts.push(claim.claim, ...claim.sectionIds, claim.verificationMethod)
      if (claim.basis !== undefined) texts.push(claim.basis)
    }
```

- [ ] **Step 5: Add final-delivery cross-field validation**

Immediately after `DecisionBriefSchema.parse(input)`:

```ts
    if (brief.mode === "author") {
      const invalidInline = brief.delivery === "inline" && brief.artifactPaths.length > 0
      const invalidMultiFile =
        brief.delivery === "multi_file" &&
        (brief.outline.length < 2 || brief.artifactPaths.length < 2)
      if (invalidInline || invalidMultiFile) {
        throw new ConsultationError(ConsultationErrorCode.VALIDATION_FAILED)
      }
    }
```

- [ ] **Step 6: Run focused and package tests**

Run:

```bash
bun test packages/consultation-core/src/decision-brief.test.ts packages/consultation-core/src/author-contracts.test.ts
bun test packages/consultation-core
bun run typecheck
```

Expected: all commands exit 0.

- [ ] **Step 7: Create an authorized checkpoint**

If commits were explicitly authorized:

```bash
GIT_MASTER=1 git add packages/consultation-core/src/decision-brief.ts packages/consultation-core/src/decision-brief.test.ts
GIT_MASTER=1 git commit -m "Add the author decision brief"
```

---

### Task 3: Add writer role contracts and backward-compatible configuration

**Files:**

- Modify: `packages/consultation-core/src/team.ts:8-41`
- Modify: `packages/consultation-core/src/team.test.ts`
- Modify: `packages/opencode-adapter/src/plugin-config.ts:12-140`
- Modify: `packages/opencode-adapter/src/plugin-config.test.ts`

**Interfaces:**

- Produces `TeamRole` variant `writer` and `RoleCaps.writer`.
- Produces config fields `writer_agent`, `writer_model`, `writer_enabled` and `resolveRoleModel(config, "writer")`.

- [ ] **Step 1: Add failing core role-cap tests**

Update the exact assertions in `team.test.ts`:

```ts
expect(TeamRoleSchema.options).toEqual(["explorer", "analyst", "critic", "verifier", "writer"])
expect(tierRoleCaps("fast")).toEqual({ explorer: 5, analyst: 0, critic: 0, verifier: 0, writer: 0 })
expect(tierRoleCaps("standard")).toEqual({ explorer: 5, analyst: 1, critic: 1, verifier: 1, writer: 1 })
expect(tierRoleCaps("deep")).toEqual({ explorer: 5, analyst: 3, critic: 2, verifier: 2, writer: 2 })
```

- [ ] **Step 2: Add failing adapter config tests**

Add to `plugin-config.test.ts`:

```ts
test("defaults the packaged writer role", () => {
  const config = ConsultationPluginConfigSchema.parse({})
  expect(config.writer_agent).toBe("consultation-writer")
  expect(config.writer_enabled).toBe(true)
  expect(resolveRoleModel(config, "writer")).toBe("deepseek/deepseek-v4-pro")
  expect(resolveTierRoleCaps(config).standard.writer).toBe(1)
  expect(resolveTierRoleCaps(config).deep.writer).toBe(2)
})

test("accepts a legacy custom role-cap matrix without writer", () => {
  const config = ConsultationPluginConfigSchema.parse({
    tier_role_caps: {
      fast: { explorer: 1, analyst: 0, critic: 0, verifier: 0 },
      standard: { explorer: 2, analyst: 1, critic: 1, verifier: 1 },
      deep: { explorer: 3, analyst: 2, critic: 2, verifier: 1 },
    },
  })
  expect(resolveTierRoleCaps(config).standard.writer).toBe(0)
})
```

- [ ] **Step 3: Verify red state**

Run:

```bash
bun test packages/consultation-core/src/team.test.ts packages/opencode-adapter/src/plugin-config.test.ts
```

Expected: FAIL because writer is not a known role/config field.

- [ ] **Step 4: Extend core roles and caps**

Change `TeamRoleSchema`, `RoleCaps`, and `TIER_ROLE_CAPS`:

```ts
export const TeamRoleSchema = z.enum(["explorer", "analyst", "critic", "verifier", "writer"])

export interface RoleCaps {
  explorer: number
  analyst: number
  critic: number
  verifier: number
  writer: number
}

export const TIER_ROLE_CAPS: Record<Tier, RoleCaps> = {
  fast: { explorer: 5, analyst: 0, critic: 0, verifier: 0, writer: 0 },
  standard: { explorer: 5, analyst: 1, critic: 1, verifier: 1, writer: 1 },
  deep: { explorer: 5, analyst: 3, critic: 2, verifier: 2, writer: 2 },
}
```

Do not add a writer phase to `TeamPhaseSchema`; writer supplies an editorial blueprint around the existing research loop.

- [ ] **Step 5: Extend validated adapter configuration**

Add writer fields to `ConsultationPluginConfigSchema`:

```ts
writer_agent: z.string().default("consultation-writer"),
writer_model: z.string().optional(),
writer_enabled: z.boolean().default(true),
```

Make old custom cap objects compatible:

```ts
const roleCapsSchema = z.object({
  explorer: z.number().int().min(0),
  analyst: z.number().int().min(0),
  critic: z.number().int().min(0),
  verifier: z.number().int().min(0),
  writer: z.number().int().min(0).default(0),
})
```

Extend model defaults and resolution:

```ts
export const MODEL_DEFAULTS = {
  consultant: "deepseek/deepseek-v4-pro",
  explorer: "deepseek/deepseek-flash",
  analyst: "opencode-go/qwen3.7-max",
  critic: "opencode-go/glm-5.2",
  verifier: "opencode-go/qwen3.7-max",
  writer: "deepseek/deepseek-v4-pro",
} as const
```

Add `case "writer": return config.writer_model ?? MODEL_DEFAULTS.writer` and add
`writer` to `RoleCapsConfig` plus the default matrices.

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```bash
bun test packages/consultation-core/src/team.test.ts packages/opencode-adapter/src/plugin-config.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 7: Create an authorized checkpoint**

If commits were explicitly authorized:

```bash
GIT_MASTER=1 git add packages/consultation-core/src/team.ts packages/consultation-core/src/team.test.ts packages/opencode-adapter/src/plugin-config.ts packages/opencode-adapter/src/plugin-config.test.ts
GIT_MASTER=1 git commit -m "Add portable writer role configuration"
```

---

### Task 4: Package, register, and dispatch the read-only writer

**Files:**

- Create: `assets/agents/writer.md`
- Modify: `packages/opencode-adapter/src/agent-registration.ts`
- Modify: `packages/opencode-adapter/src/agent-registration.test.ts`
- Modify: `packages/opencode-adapter/src/dispatch-tool.ts`
- Modify: `packages/opencode-adapter/src/dispatch-tool.test.ts`
- Modify: `packages/opencode-adapter/src/plugin.ts`
- Modify: `packages/opencode-adapter/src/plugin.test.ts`
- Modify: `script/install-local.ts:24-33`

**Interfaces:**

- Produces `registerWriter(config, pluginConfig)`.
- Extends `consultation_dispatch` role enum with `writer`.
- Ships `assets/agents/writer.md` in installed artifacts.

- [ ] **Step 1: Write failing registration and dispatch tests**

Add assertions following existing verifier cases:

```ts
test("registerWriter installs a shell-free read-only writer", async () => {
  const config: { agent?: Record<string, unknown> } = {}
  const pluginConfig = ConsultationPluginConfigSchema.parse({})
  await registerWriter(config, pluginConfig)
  expect(config.agent?.["consultation-writer"]).toMatchObject({
    mode: "subagent",
    model: "deepseek/deepseek-v4-pro",
    permission: { edit: "deny", bash: "deny" },
  })
})
```

In `dispatch-tool.test.ts`, extend the role list assertion and add:

```ts
test("resolves the configured writer target", () => {
  const config = ConsultationPluginConfigSchema.parse({
    writer_agent: "custom-writer",
    writer_model: "provider/writer-model",
  })
  expect(resolveRoleTarget(config, "writer")).toEqual({
    agentName: "custom-writer",
    model: "provider/writer-model",
  })
})
```

Add plugin-hook assertions that writer is registered by default and absent when
`writer_enabled: false` is loaded from isolated `CONSULTATION_CONFIG`.

- [ ] **Step 2: Verify red state**

Run:

```bash
bun test packages/opencode-adapter/src/agent-registration.test.ts packages/opencode-adapter/src/dispatch-tool.test.ts packages/opencode-adapter/src/plugin.test.ts
```

Expected: FAIL because writer registration and dispatch do not exist.

- [ ] **Step 3: Create the portable writer prompt**

Create `assets/agents/writer.md` with this complete contract:

```markdown
# Consultation Writer

You are the read-only writing specialist for `author` consultations. Produce a
writing blueprint or editorial review from the supplied evidence packet. Never
research missing facts, execute commands, write files, or override the
consultant's final editorial control.

Adapt explicitly to the supplied audience, profile, language, assumed knowledge,
tone, terminology, code-to-prose ratio, analogy policy, and neighboring-section
summaries. For tutorials, enforce progressive examples, observable outcomes,
misconceptions, and learning checks. For architecture documents, preserve exact
symbol/path references and distinguish observation from interpretation. For
technical explanations, begin with a bounded mental model, then explain the real
mechanism and the limits of the analogy.

Return one structured object with: `voice`, `progressiveDisclosure`,
`headingPattern`, `exampleProgression`, `terminologyRules`, `antiPatterns`, and
either `representativeDraft` or `editorialFindings`. Do not add unsupported facts.
```

- [ ] **Step 4: Register writer with stricter permissions**

Widen `SubagentEntry.permission` to `Record<string, string>`. Extend
`registerReadOnlySubagent` options with `denyBash?: boolean` and construct:

```ts
permission: options.denyBash
  ? { edit: "deny", bash: "deny" }
  : { edit: "deny" },
```

Add `WRITER_DESCRIPTION` and:

```ts
export async function registerWriter(
  config: MutableConfig,
  pluginConfig: ConsultationPluginConfig,
): Promise<void> {
  await registerReadOnlySubagent(config, {
    name: pluginConfig.writer_agent,
    description: WRITER_DESCRIPTION,
    assetFile: "agents/writer.md",
    model: resolveRoleModel(pluginConfig, "writer"),
    denyBash: true,
  })
}
```

Extend runtime bindings with writer enabled/disabled state and `wN` in each tier
matrix.

- [ ] **Step 5: Dispatch and plugin registration**

Append `writer` to `DISPATCH_ROLES` and add its exhaustive switch case in
`resolveRoleTarget`. Update tool descriptions from four roles to five.

Import and conditionally call `registerWriter` in `createConsultationConfigHook`:

```ts
if (pluginConfig.writer_enabled) {
  await registerWriter(config, pluginConfig)
}
```

- [ ] **Step 6: Require the writer asset in packaged installs**

Add `"assets/agents/writer.md"` to `REQUIRED_INSTALLED_FILES` in
`script/install-local.ts`.

- [ ] **Step 7: Run adapter tests and typecheck**

Run:

```bash
bun test packages/opencode-adapter
bun run typecheck
```

Expected: PASS and writer prompt resolution succeeds from source assets.

- [ ] **Step 8: Create an authorized checkpoint**

If commits were explicitly authorized:

```bash
GIT_MASTER=1 git add assets/agents/writer.md packages/opencode-adapter/src/agent-registration.ts packages/opencode-adapter/src/agent-registration.test.ts packages/opencode-adapter/src/dispatch-tool.ts packages/opencode-adapter/src/dispatch-tool.test.ts packages/opencode-adapter/src/plugin.ts packages/opencode-adapter/src/plugin.test.ts script/install-local.ts
GIT_MASTER=1 git commit -m "Register the packaged author writer role"
```

---

### Task 5: Add the author workflow to the skill and consultant prompt

**Files:**

- Modify: `assets/skills/consultation/SKILL.md`
- Modify: `assets/agents/consultant.md`
- Test: `packages/opencode-adapter/src/plugin.test.ts`
- Test: `packages/opencode-adapter/src/skill-installer.test.ts`

**Interfaces:** Prompt-only behavior aligned with Tasks 1-4 schemas and runtime bindings.

- [ ] **Step 1: Add failing asset-content assertions**

Add assertions that the packaged/installed prompt text contains all stable tokens:

```ts
expect(consultantPrompt).toContain("`author`")
expect(consultantPrompt).toContain("tutorial")
expect(consultantPrompt).toContain("architecture")
expect(consultantPrompt).toContain("explanation")
expect(consultantPrompt).toContain("outline approval")
expect(consultantPrompt).toContain("light")
expect(consultantPrompt).toContain("targeted")
expect(consultantPrompt).toContain("strict")
```

For the installed skill, assert `author` and all three profiles are present.

- [ ] **Step 2: Verify red state**

Run:

```bash
bun test packages/opencode-adapter/src/plugin.test.ts packages/opencode-adapter/src/skill-installer.test.ts
```

Expected: FAIL on missing author workflow text.

- [ ] **Step 3: Extend mode routing in both assets**

Add `author` as the sixth mode with this boundary:

```markdown
- **author** — create a durable technical document for later reading or sharing.
  Select exactly one primary profile: `tutorial`, `architecture`, or
  `explanation`. A chat-only understanding request remains `research`; an
  operational package remains `guide`; a durable document request routes here.
```

Correct the stale skill Purpose text from "four modes" to "six modes".

- [ ] **Step 4: Add the complete author workflow**

Document in both assets:

```text
route -> ask audience/delivery/scope -> explore load-bearing claims
-> dispatch writer for blueprint -> present outline and file manifest
-> wait for one approval -> author continuously -> verify proportionately
-> cross-file check -> final AuthorBrief -> memory summary
```

Include all profile contracts from the approved design, the delivery values,
profile-specific verification defaults, staged permission policy, writer fallback,
and clean portability rule. State explicitly that absent writer/filesystem/shell
capabilities cause inline degradation with disclosure, never a call to another
host-specific agent or category.

- [ ] **Step 5: Add the author output template**

The skill template must include:

```markdown
# <document title>

Audience: <reader level>. Scope: <version and exclusions>.
Delivery: <inline | single_file | multi_file>.
Verification: <light | targeted | strict>.

## Approved document map
| file/section | purpose | prerequisites | verification target |

## Artifact result
<inline content or approved relative paths>

## Verification summary
<sources/source paths/commands actually checked; residual uncertainty>

Next: <first reading, review, or follow-up action>.
```

- [ ] **Step 6: Run prompt tests**

Run:

```bash
bun test packages/opencode-adapter/src/plugin.test.ts packages/opencode-adapter/src/skill-installer.test.ts
```

Expected: PASS.

- [ ] **Step 7: Create an authorized checkpoint**

If commits were explicitly authorized:

```bash
GIT_MASTER=1 git add assets/agents/consultant.md assets/skills/consultation/SKILL.md packages/opencode-adapter/src/plugin.test.ts packages/opencode-adapter/src/skill-installer.test.ts
GIT_MASTER=1 git commit -m "Add the author workflow prompts"
```

---

### Task 6: Add author evaluation cases

**Files:**

- Modify: `evals/fixtures/consultation-cases.json`

**Interfaces:** Model-graded routing and workflow cases; deterministic backstops point to Tasks 1-5 tests.

- [ ] **Step 1: Append three model-graded cases**

Add C12-C14:

```json
{
  "id": "C12",
  "title": "A durable Kotlin course routes to author tutorial",
  "given": "The user asks for a multi-file Kotlin coroutines teaching document for readers new to coroutines.",
  "when": "The consultant detects the deliverable and profile",
  "then": "It routes to author with tutorial profile, asks for missing audience or delivery information, and does not route to research or guide.",
  "grading": "model",
  "notes": "Rubric: Does the agent choose author/tutorial because a durable teaching artifact is requested and avoid conflating it with a chat research report or operational guide? Deterministic backstop: author mode and profile schemas are covered by author-contracts.test.ts and decision-brief.test.ts."
},
{
  "id": "C13",
  "title": "A large author request waits at one outline gate",
  "given": "The requested tutorial needs an index and several chapter files.",
  "when": "The consultant completes scoped exploration",
  "then": "It presents audience, scope, file manifest, verification targets, and destination, then waits for approval before drafting chapters.",
  "grading": "model",
  "notes": "Rubric: Does the agent stop after a concrete outline/manifest and request exactly one approval before continuous authoring?"
},
{
  "id": "C14",
  "title": "Targeted author verification avoids unnecessary adversarial work",
  "given": "A code tutorial contains representative runnable examples but no disputed, high-risk, or manipulation-prone claims.",
  "when": "The consultant selects verification work",
  "then": "It verifies load-bearing examples with available project tools, skips critic and verifier, and reports actual commands and remaining gaps.",
  "grading": "model",
  "notes": "Rubric: Does targeted verification check representative code without invoking critic/verifier by default, and avoid claiming commands ran without evidence?"
}
```

- [ ] **Step 2: Run the eval checklist**

Run:

```bash
bun run evals/run-evals.ts
```

Expected: exits 0; C12-C14 print under MODEL-GRADED; no deterministic case is unmapped.

- [ ] **Step 3: Create an authorized checkpoint**

If commits were explicitly authorized:

```bash
GIT_MASTER=1 git add evals/fixtures/consultation-cases.json
GIT_MASTER=1 git commit -m "Add author mode evaluation cases"
```

---

### Task 7: Document the public author contract and portable configuration

**Files:**

- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/deployment.md`

**Interfaces:** Public documentation mirrors mode, model, role-cap, and deployment defaults.

- [ ] **Step 1: Update README mode and package maps**

Add an `author` row describing durable tutorial/architecture/explanation artifacts,
the outline gate, delivery choices, and verification choices. Add `writer.md` to
the assets list and state that writer is plugin-owned and optional.

- [ ] **Step 2: Update architecture contracts**

Update the mode count, routing diagram, output-contract section, role table,
tier-role matrix, workflow diagram, and evaluation list. Add the invariant:

```text
AuthorBrief is the validation/memory unit; authored files are caller-approved
side products referenced by the brief, not stored in memory.
```

- [ ] **Step 3: Update deployment defaults**

Add `writer`, `writer_agent`, `writer_model`, `writer_enabled`, and writer cap
fields to documented configuration. State:

```text
The installed plugin ships writer.md and does not require OMO, Janus, global
agent files, external skills, or the source checkout. Missing writer capability
degrades to inline packaged prompt behavior.
```

- [ ] **Step 4: Check stale counts and names**

Run:

```bash
rg -n "four modes|five modes|four roles|three consultation subagents" README.md docs assets packages/opencode-adapter/src
```

Expected: every count accurately reflects six modes and five dispatch roles;
historical approved specs may retain their historical counts.

- [ ] **Step 5: Create an authorized checkpoint**

If commits were explicitly authorized:

```bash
GIT_MASTER=1 git add README.md docs/architecture.md docs/deployment.md
GIT_MASTER=1 git commit -m "Document the portable author mode"
```

---

### Task 8: Strengthen clean-room installed-artifact integration

**Files:**

- Modify: `script/integration-opencode.ts:1-319`
- Modify: `script/install-local.ts:24-33` if not already changed in Task 4

**Interfaces:** Proves the staged bundle registers consultant, writer, memory MCP,
and skill without reading developer-local configuration.

- [ ] **Step 1: Add failing clean-room assertions**

Add `readFileSync` to the existing `node:fs` import. Then extend the `/config`
checks:

```ts
const hasWriter = hasNestedKey(json, "agent", "consultation-writer")
assertions.push({
  name: "config has packaged writer agent key",
  pass: hasWriter,
  detail: hasWriter ? "agent.consultation-writer present" : "agent.consultation-writer MISSING",
})
```

After checking the installed skill file, read it and assert it contains `` `author` ``.
Also assert the installed prefix contains `assets/agents/writer.md` before starting
OpenCode when `CONSULTATION_PLUGIN_ENTRY` points to an installed bundle.

- [ ] **Step 2: Scrub local configuration overrides from the child environment**

After constructing `childEnv`, delete variables that can bridge into the
developer machine:

```ts
for (const key of [
  "CONSULTATION_CONFIG",
  "OPENCODE_CONFIG",
  "OPENCODE_CONFIG_CONTENT",
  "OPENCODE_CONFIG_DIR",
]) {
  delete childEnv[key]
}
childEnv.OPENCODE_DISABLE_EXTERNAL_SKILLS = "1"
childEnv.OPENCODE_DISABLE_CLAUDE_CODE_SKILLS = "1"
```

Keep isolated `HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, and
`XDG_CACHE_HOME`. Do not use `OPENCODE_PURE=1`, because it may disable the plugin
entry being proved.

- [ ] **Step 3: Build, stage, and prove one concrete temporary install**

Run:

```bash
INSTALL_ROOT="$(mktemp -d)/consultation-agent-plugin" && CONSULTATION_INSTALL_DIR="$INSTALL_ROOT" bun run install:local && CONSULTATION_PLUGIN_ENTRY="$INSTALL_ROOT/dist/index.js" bun run integration
```

Expected: output reports the writer asset among required files and produces an
installed `dist/index.js` entry, then integration passes for consultant, writer,
memory MCP, installed author skill, and unchanged repository state.

- [ ] **Step 4: Create an authorized checkpoint**

If commits were explicitly authorized:

```bash
GIT_MASTER=1 git add script/integration-opencode.ts script/install-local.ts
GIT_MASTER=1 git commit -m "Prove author mode in a clean-room install"
```

---

### Task 9: Full verification and scope audit

**Files:** none modified unless verification exposes an author-mode regression.

**Interfaces:** Final project gate.

- [ ] **Step 1: Run changed-file diagnostics**

Run `lsp_diagnostics` on every changed `.ts` file. Expected: zero errors and zero
new warnings. Markdown has no configured LSP; use `git diff --check` for Markdown.

- [ ] **Step 2: Run all unit tests**

```bash
bun test
```

Expected: exit 0 across all packages.

- [ ] **Step 3: Run strict typechecking**

```bash
bun run typecheck
```

Expected: exit 0 with no TypeScript errors.

- [ ] **Step 4: Run eval checklist**

```bash
bun run evals/run-evals.ts
```

Expected: exit 0; C12-C14 are MODEL-GRADED and every deterministic case maps to
an existing test file.

- [ ] **Step 5: Build and install from artifacts**

```bash
bun run install:local
```

Expected: bundle and required assets stage successfully.

- [ ] **Step 6: Prove the installed bundle**

```bash
CONSULTATION_PLUGIN_ENTRY="$HOME/.local/share/consultation-agent-plugin/dist/index.js" bun run integration
```

Expected: PASS, or a clear SKIP only when OpenCode is not on PATH.

- [ ] **Step 7: Audit forbidden local dependencies**

```bash
rg -n "Janus|Sisyphus|OMO|~/.omo|~/.config/opencode/agents|task\(category" packages assets script
```

Expected: no runtime dependency. Any match must be an explicit negation in test
or documentation, not executable behavior or prompt routing.

- [ ] **Step 8: Verify diff hygiene and user-owned changes**

```bash
GIT_MASTER=1 git diff --check
GIT_MASTER=1 git status --short
```

Expected: no whitespace errors; `userdoc/jetpack-compose-internals-composer.md`
remains untouched and unstaged unless the user independently changed/staged it.

---

## Self-Review Notes

- **Spec coverage:** Task 1 covers mode/profile/delivery/verification schemas; Task 2 covers one-brief validation and artifact manifest references; Tasks 3-4 cover the optional packaged writer and caps; Task 5 covers intake, profiles, outline gate, staged permissions, degradation, and memory wording; Task 6 covers model behavior; Task 7 covers public contracts; Task 8 proves portability; Task 9 runs the release gate.
- **Portability:** No implementation task reads local Janus/OMO config. Writer is a packaged asset and validated adapter role. The clean-room test isolates all XDG/HOME paths and removes explicit config overrides.
- **Backward compatibility:** Existing modes are untouched. Legacy custom cap matrices parse because `writer` defaults to 0 inside supplied matrices; package defaults use 0/1/2.
- **Type consistency:** `AuthorProfile`, `AuthorDelivery`, `AuthorVerification`, `AuthorSection`, `AuthorClaim`, `AuthorBrief`, and writer config names are identical across core, adapter, tests, prompts, and docs.
- **No placeholder implementation:** The temporary install path in Task 8 is an execution-time value produced by the immediately preceding command, not an unresolved design decision.
- **Scope:** No filesystem-writing tool or artifact persistence subsystem is added. The consultant primary uses existing host capabilities after approval; core only validates the final brief.
