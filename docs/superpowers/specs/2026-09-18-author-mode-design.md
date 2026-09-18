# Design: `author` mode for durable technical documents

Date: 2026-09-18
Status: Approved (including clean-room portability and no local-agent dependency)
Scope: Additive. Existing `select`, `verify`, `plan`, `research`, and `guide`
behavior remains unchanged.

## 1. Context

The consultant currently produces consultation answers: candidate comparisons,
claim verdicts, plans, research reports, and operational guides. Those outputs
are useful in a conversation, but they do not provide a complete workflow for
creating durable technical documents such as:

- a multi-file Kotlin coroutines course;
- a Jetpack Compose tutorial from fundamentals through runtime internals;
- a codebase architecture analysis with source references;
- a technical-principle explanation intended for later study or sharing.

These tasks differ from ordinary `research` and `guide` requests in four ways:

1. The output is a reusable artifact, not only a chat answer.
2. Large topics need an approved outline and multiple coordinated files.
3. Teaching quality depends on audience, prerequisites, progression, examples,
   misconceptions, and learning checks.
4. Technical correctness may require source inspection, compilation, or runtime
   experiments, without requiring the full adversarial consultation loop for
   every paragraph.

The design combines the consultant's evidence discipline with the useful ideas
identified in the Janus comparison: long tool loops, source inspection,
executable verification, and writing-style adaptation. These ideas are
reimplemented as project-owned behavior. The shipped plugin does not call,
configure, or require Janus, OMO categories, local agents, or machine-specific
OpenCode configuration.

## 2. Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Taxonomy | Add a sixth first-class mode, `author` | A durable technical document is a distinct deliverable and should not overload `research` or `guide`. |
| 2 | Document kinds | Use `tutorial`, `architecture`, and `explanation` as profiles inside `author` | Profiles need different templates but share one artifact lifecycle; separate modes would create routing overlap. |
| 3 | Artifact shape | Add `inline`, `single_file`, and `multi_file` as an orthogonal delivery axis | File count is independent of the user's underlying intent. |
| 4 | Verification | Add `light`, `targeted`, and `strict` as an orthogonal verification axis | Correctness effort should track the claims and code, not automatically trigger the full critic loop. |
| 5 | Intake | Ask for learner level when absent and ask delivery shape every time | These choices materially change structure and scope. |
| 6 | Large-document gate | Present the outline and file manifest once; continue only after approval | One early gate prevents large-scale rework without requiring approval after every chapter. |
| 7 | Writing specialization | Add an optional read-only `writer` subagent | It supplies a writing blueprint and editorial review without receiving file or execution permissions. |
| 8 | File ownership | The consultant primary writes artifacts and runs verification | The primary retains editorial control and can use host tools; research and writer subagents remain read-only. |
| 9 | Output location | Ask before delivery and use the destination explicitly approved by the caller | A public plugin must not encode one developer's local documentation convention. |
| 10 | Memory | Save the document decision, manifest path, audience, and verification summary, never full document text | Supports resumption without bloating or duplicating the artifact. |

## 3. Why not merge existing modes

### 3.1 Extending `research` and `guide`

This would minimize code changes but would weaken their meanings:

- `research` answers "what should I understand?" with a readable report;
- `guide` answers "what do I need to do?" with an operational playbook;
- `author` answers "what durable document should be produced for this reader?".

Adding outline approval, file manifests, writing profiles, compilation, and
cross-file checks to both `research` and `guide` would duplicate behavior and
conflict with their current concise output contracts.

### 3.2 Three new modes

Separate `teach`, `architecture`, and `explain` modes would provide narrow
templates but introduce severe overlap. A Compose runtime course can be all
three at once. Profiles preserve specialization without expanding the routing
surface from six modes to eight.

## 4. Taxonomy and routing

The mode axis continues to answer "what kind of deliverable is required?":

| Mode | Deliverable | Typical question |
|------|-------------|------------------|
| `select` | candidate comparison | Which option should I choose? |
| `verify` | claim verdict | Is this claim true? |
| `plan` | action plan | How should I achieve this goal? |
| `research` | understanding-oriented report | What is known about this topic? |
| `guide` | operational playbook | What do I need to get this done? |
| `author` | durable technical document | Write material that teaches or documents this topic. |

### 4.1 Positive routing signals

Route to `author` when the user asks to create, write, maintain, or update a
durable document, including terms such as:

- 教程、课程、教学文档、学习材料、技术文章;
- 架构分析文档、源码分析文档、设计说明;
- 原理讲解文档、write-up, tutorial, course, architecture document;
- explicit requests for Markdown files, chapters, a document set, or content to
  keep and share.

### 4.2 Routing precedence

- "Explain X briefly" remains a simple answer or `research`.
- "Research X deeply" remains `research` unless a durable artifact is requested.
- "Give me everything needed to do X" remains `guide` unless the output is an
  instructional document for later use.
- "How should I do X?" remains `plan`.
- "Write a guide/tutorial that teaches X" routes to `author` because the durable
  teaching artifact is the dominant deliverable.
- "Analyze this repository's architecture" routes to `research` for a chat
  answer and `author(architecture)` when a document is requested.

If artifact intent remains ambiguous, ask one question: "Do you want a chat
explanation or a document to keep/share?"

## 5. Orthogonal axes

### 5.1 Author profile

```text
tutorial      learner progression and executable examples
architecture  code/system structure and source-backed relationships
explanation   mental model and mechanism for a technical principle
```

A document may contain elements from other profiles, but one profile is primary
and controls its outline and quality checks.

### 5.2 Delivery

```text
inline        content is returned in chat
single_file   one Markdown file
multi_file    an index plus multiple chapter files
```

The consultant asks every time before committing to a delivery shape and file
destination. It resolves relative paths against the active project root. It does
not hard-code `userdoc/`, `docs/`, a home-directory path, or any path from the
machine on which the plugin was developed. Host- or project-level instructions
may establish a preferred documentation directory; the consultant follows those
instructions when present and surfaces the resolved destination for approval.

### 5.3 Verification

```text
light     check load-bearing claims against authoritative material or source
targeted  light checks plus compile/runtime checks for representative or risky code
strict    verify all feasible examples and run a critic pass on major conclusions
```

Profile defaults:

| Profile | Default | Reason |
|---------|---------|--------|
| `tutorial` | `targeted` | Learners need runnable, version-applicable examples. |
| `architecture` | `light` | Source paths and call relationships matter more than executing every path. |
| `explanation` | `light` | Primary documentation and source inspection usually establish the mechanism. |

Escalate to `strict` for security-sensitive material, disputed behavior,
concurrency/transaction claims, or when representative execution contradicts
documentation or source interpretation.

Verification depth is independent of consultation tier. Tier controls research
cost and synthesis breadth; verification controls how technical claims are
checked.

## 6. Intake contract

The existing one-to-three-question limit remains. Ask only decision-changing
questions, in this priority order:

1. Learner or reader level when absent: introductory, advanced, source-level, or
   a user-described audience.
2. Delivery: inline, single file, or multiple files.
3. Scope/version/environment when it materially changes correctness.

For a large document, do not ask chapter-by-chapter questions. Record remaining
assumptions in the outline proposal.

## 7. Author brief contract

`author` preserves the invariant:

```text
one request -> one mode -> one validated brief
```

The validated brief describes and references the artifact; it does not embed the
entire long document.

Illustrative schema:

```ts
const AuthorProfileSchema = z.enum(["tutorial", "architecture", "explanation"])
const AuthorDeliverySchema = z.enum(["inline", "single_file", "multi_file"])
const AuthorVerificationSchema = z.enum(["light", "targeted", "strict"])

const AuthorSectionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  purpose: z.string().min(1),
  file: z.string().optional(),
  learningObjectives: z.array(z.string()).default([]),
  prerequisites: z.array(z.string()).default([]),
  verificationTargets: z.array(z.string()).default([]),
})

const AuthorClaimSchema = z.object({
  claim: z.string().min(1),
  sectionIds: z.array(z.string()).min(1),
  status: EpistemicStatusSchema,
  basis: z.string().optional(),
  verificationMethod: z.string().min(1),
}).refine(basisRefinement((claim) => claim.status), {
  message: "inferred/unverifiable author claims must carry a basis",
  path: ["basis"],
})

const AuthorBriefSchema = z.object({
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
  artifactPaths: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  residualUncertainty: z.array(z.string()).default([]),
})
```

Design constraints:

- `AuthorBriefSchema` remains a plain `z.object` for the discriminated union.
- Cross-field rules run in `validateDecisionBrief`.
- `multi_file` requires at least two outline sections and, after delivery, at
  least an index plus one chapter in `artifactPaths`.
- `inline` requires `artifactPaths` to be empty.
- Every `AuthorClaim` with `inferred` or `unverifiable` status carries a basis.
- `briefTexts` scans author fields for prohibited numeric confidence claims.
- The existing source cap represents key sources in the brief; a document may
  contain a longer references section.

Section-level epistemic labels are intentionally avoided. A section can contain
many claims with different support. Only load-bearing claims are tracked in the
brief, while ordinary citations remain in the document.

The outline proposal is an interaction checkpoint, not a partially valid
`AuthorBrief`. `AuthorBrief` is validated only for the final delivery, so final
cross-field rules do not prevent the pre-writing approval stage.

## 8. Writing blueprint and `writer` role

Add a fifth optional read-only consultation role, `writer`. This is a role owned
and registered by this plugin, not OpenCode's or OMO's `writing` category.

It does not write files or run commands. The adapter registers it with both
`edit: deny` and `bash: deny`; the prompt prohibition is not the only control.
It receives a compact editorial packet:

```text
profile
audience and assumed knowledge
goal and approved outline
desired tone and language
terminology/glossary decisions
code-to-prose ratio
analogy and example policy
source notes for the section
neighboring-section summaries
```

It returns a structured `WritingBlueprint`:

```text
voice and tone
progressive-disclosure rules
heading and paragraph pattern
example progression
terminology rules
anti-patterns to avoid
representative section draft or editorial review
```

Usage policy:

- Standard author work dispatches one writer for the blueprint or first-chapter
  review.
- Deep author work may dispatch a second writer for cross-document editorial
  consistency.
- The consultant remains the final editor and writes all files.
- If the writer is disabled or unavailable, the consultant constructs the same
  blueprint inline and discloses the degradation.

Adapter additions:

- `writer_agent`, `writer_model`, and `writer_enabled` configuration fields;
- `writer` in `DISPATCH_ROLES` and runtime bindings;
- a read-only `assets/agents/writer.md` prompt;
- a writer-specific permission entry that denies edit and shell execution;
- writer counts in per-tier role caps: fast `0`, standard `1`, deep `2`.

`writer_model` is resolved through the plugin's existing validated configuration
and `MODEL_DEFAULTS`, exactly like explorer/analyst/critic/verifier. Its packaged
default must not be copied from `~/.omo/omo.jsonc` or depend on an OMO fallback
chain. The initial default is `deepseek/deepseek-v4-pro`, matching the existing
consultant provider requirement; deployments may override it. If the configured
writer model or role is unavailable, the consultant applies the packaged writer
prompt inline rather than delegating to a host-specific category.

`author` never uses fast tier, so no writer is dispatched for fast consultations.

## 9. Profile-specific document contracts

### 9.1 Tutorial

Required design elements:

1. Audience and prerequisites.
2. Learning objectives and a concept map.
3. A minimal mental model before detailed APIs.
4. Progressive examples from isolated concepts to realistic composition.
5. Expected output or observable behavior for executable steps.
6. Common mistakes, why they happen, and how to diagnose them.
7. Exercises or understanding checks with answer guidance.
8. A summary and a path to the next level.

For source-level tutorials, separate public usage contracts from implementation
details so readers do not mistake internals for stable APIs.

### 9.2 Architecture analysis

Required design elements:

1. Scope, system context, and explicit exclusions.
2. Component/module map.
3. Data flow, control flow, and lifecycle boundaries.
4. Key abstractions and dependency direction.
5. Important design decisions and trade-offs.
6. Source map with stable paths and symbol names.
7. Runtime or build behavior where static inspection is insufficient.
8. Extension points, constraints, risks, and unresolved questions.

Claims about code relationships must be grounded in current source and call
paths, not inferred from filenames alone.

### 9.3 Technical explanation

Required design elements:

1. The precise question and why it matters.
2. An intuitive mental model, clearly marked as analogy when applicable.
3. The actual mechanism, step by step.
4. Boundaries where the model stops being accurate.
5. Minimal examples and counterexamples.
6. Common misconceptions and their correction.
7. Connections to adjacent concepts.
8. Source or experimental support for load-bearing claims.

## 10. Large-document workflow

The state machine is:

```text
route
  -> intake
  -> scoped exploration
  -> writing blueprint
  -> outline + file manifest
  -> outline approval
  -> continuous authoring
  -> targeted verification
  -> cross-file editorial check
  -> final brief + delivery
  -> memory summary
```

### 10.1 Outline proposal

Before writing a large document, present:

- audience and assumed prerequisites;
- learning or documentation goal;
- chapter/file list with one-sentence purpose;
- load-bearing claims requiring verification;
- planned executable examples;
- verification depth and permission implications;
- estimated artifact location.

The user approves this once. Later scope additions require approval only for the
outline delta, not for unaffected chapters.

### 10.2 Multi-file layout

Example:

```text
<approved-document-root>/kotlin-coroutines/
  README.md
  01-mental-model.md
  02-suspension-and-continuations.md
  03-structured-concurrency.md
  04-context-and-dispatchers.md
  05-flow.md
  06-testing-and-debugging.md
  07-runtime-internals.md
  glossary.md
  references.md
```

`README.md` is both the reading map and artifact manifest. It records audience,
version scope, chapter order, learning paths, and links. No private workflow
state or unverified scratch notes are placed in the published document tree.

### 10.3 Continuation and recovery

If work is interrupted:

1. Read the approved document map and existing chapter files.
2. Compare them with the saved manifest path and author brief summary.
3. Resume at the first missing or incomplete chapter.
4. Re-run only verification affected by subsequent source or version changes.

Memory stores the manifest path, audience, scope/version, writing blueprint
summary, and verification summary. It never stores full chapter contents.

## 11. Source and execution verification

### 11.1 Verification targets

Prioritize claims whose failure would teach the wrong model:

- API signatures and version availability;
- ordering, lifecycle, concurrency, cancellation, or transactional behavior;
- compiler/plugin transformations;
- source-level control flow;
- observable output of examples;
- performance or safety claims.

Do not spend equal effort checking introductory prose, analogies, or widely
established definitions.

### 11.2 Permission policy

The selected policy is staged and confirmation-based. It is expressed in the
packaged author prompt and depends only on capabilities exposed by the current
host adapter:

- Read current project source: proceed.
- Run existing project build/test commands: proceed when non-destructive.
- Create a temporary verification project: ask first.
- Download new dependencies or SDK components: ask first.
- Modify user application code: ask first unless explicitly requested.
- Write the requested document under the approved destination: proceed after the
  outline and destination are approved.

The consultant discovers existing build commands and toolchains from the active
project; it does not assume Bun, Gradle, Android SDK, Kotlin, Java, Node, or any
absolute executable path. Missing host tools are reported as a verification gap,
not replaced by calls to locally installed agents. Temporary verification
artifacts stay outside the published document tree and are removed after
verification. Never edit generated `dist/` or installed plugin artifacts.

### 11.3 Evidence and adversarial roles

- Explorer gathers authoritative documentation and source evidence.
- Analyst resolves mechanisms and architecture relationships for complex claims.
- Critic is omitted by default in `light` and `targeted` authoring.
- Critic runs for `strict`, conflicting evidence, high-risk material, or a failed
  execution that challenges the current explanation.
- Verifier runs only when the document contains user-generated product claims,
  recommendations, or manipulation-prone evidence.

This deliberately weakens adversarial verification for ordinary teaching while
preserving correctness escalation.

## 12. Completion checks

All author profiles must pass:

- every approved outline item is delivered or explicitly removed by approval;
- terminology and version assumptions are consistent;
- relative links and file references resolve;
- load-bearing claims have a source, source-code basis, or experiment result;
- residual uncertainty is disclosed without cluttering ordinary prose;
- the final brief lists artifact paths and verification performed;
- no command or compilation success is claimed without actual output.

Tutorial additionally checks that examples progress, expected behavior is stated,
and exercises align with learning objectives.

Architecture additionally checks that component relationships and source symbols
match the inspected revision.

Explanation additionally checks that analogies are bounded and misconceptions
are explicitly corrected.

## 13. Memory behavior

Save one consultation record containing:

- document topic, profile, audience, and scope/version;
- approved manifest path and artifact paths;
- writing blueprint summary;
- load-bearing conclusions and residual uncertainty;
- verification methods and commands, summarized rather than copied verbatim.

For `tutorial`, register a pending outcome: whether the learner could follow the
material and whether examples worked. Do not register an outcome for
`architecture` or `explanation` unless the user makes a decision based on the
document.

## 14. Failure handling

| Failure | Behavior |
|---------|----------|
| Mode ambiguity | Ask whether the user wants a chat answer or durable document. |
| Missing reader level | Ask one learner-level question before outlining. |
| Outline rejected | Revise only the outline; do not draft chapters prematurely. |
| Scope expands mid-write | Present the manifest delta for approval. |
| Writer unavailable | Build the writing blueprint inline and disclose it. |
| Source unavailable | Mark the affected claim unverifiable and avoid teaching it as fact. |
| Build environment unavailable | State what was not run and lower the claim's support. |
| Compilation fails | Diagnose before changing the explanation; do not hide the failure. |
| Document exceeds one session | Resume from README/manifest and memory summary. |
| Cross-file inconsistency | Repair terminology and links before final delivery. |

## 15. Evaluation strategy

### 15.1 Deterministic tests

- `ConsultationModeSchema` accepts `author` and still rejects unknown modes.
- `DecisionBriefSchema` routes `mode: "author"` correctly.
- All three profiles, delivery values, and verification values validate.
- Empty audience, goal, outline, purpose, and style summary are rejected.
- Inferred/unverifiable load-bearing claims require a basis.
- `inline` rejects artifact paths.
- completed `multi_file` rejects fewer than an index and one chapter.
- numeric confidence scanning covers all author text fields.
- dispatch accepts `writer` and pins its configured model.
- writer registration remains read-only and respects disable/override config.
- runtime bindings report writer availability and model.

### 15.2 Model-graded evaluations

- A Kotlin coroutines course request routes to `author(tutorial)` rather than
  `guide` or `research`.
- A request to explain suspension in chat remains `research` or a simple answer.
- A repository architecture document routes to `author(architecture)`.
- The consultant asks for learner level when missing.
- A large request proposes a multi-file manifest and waits at the outline gate.
- Tutorial output contains progressive examples, misconceptions, and checks.
- Architecture output cites current symbols and separates observed structure from
  interpretation.
- Technical explanation bounds analogies and identifies load-bearing claims.
- Targeted verification runs representative examples without invoking the full
  critic loop unnecessarily.
- Writer output follows the supplied audience and style blueprint without taking
  final editorial control.

### 15.3 End-to-end fixture

Use one bounded Compose or Kotlin coroutine sample that can run in the repository
or a user-approved temporary directory. The fixture verifies the workflow rather
than attempting to generate an entire production course during eval.

## 16. Expected implementation surface

Core:

- `packages/consultation-core/src/enums.ts`
- `packages/consultation-core/src/decision-brief.ts`
- adjacent tests

Adapter and role registration:

- `packages/opencode-adapter/src/plugin-config.ts`
- `packages/opencode-adapter/src/agent-registration.ts`
- `packages/opencode-adapter/src/dispatch-tool.ts`
- corresponding tests and mirrored model assertions
- `assets/agents/writer.md`

Prompts and evaluations:

- `assets/agents/consultant.md`
- `assets/skills/consultation/SKILL.md`
- `evals/fixtures/consultation-cases.json`
- `evals/run-evals.ts` when deterministic mappings are added

Documentation:

- `README.md`
- `docs/architecture.md`
- `docs/deployment.md` if model defaults or role configuration are documented

Memory schemas are expected to remain mode-neutral. Implementation must confirm
this with a reference search before changing memory packages.

## 17. Portability and deployment

`author` must work from the plugin's installed bundle on another machine. The
implementation therefore follows these constraints:

1. All prompts and role assets ship under this repository's `assets/` and are
   staged by `bun run install:local` or the release packaging process.
2. The writer is registered by `packages/opencode-adapter`; no global agent file
   under `~/.config/opencode/agents/` is required.
3. No runtime reference is made to `~/.omo/omo.jsonc`, Janus, Sisyphus, OMO
   categories, user-installed skills, or this development checkout.
4. Models are selected through the plugin's validated config with packaged
   defaults. A missing optional writer degrades to packaged inline behavior.
5. Core schemas remain harness-neutral. Filesystem and command execution stay in
   the OpenCode adapter/primary-agent capability boundary.
6. Source inspection and verification use tools exposed by the active host. If a
   future non-OpenCode adapter cannot write files or execute commands, it may
   support `inline` delivery and report unsupported verification levels without
   changing core contracts.
7. The installed integration proof must load only the staged `dist/` and
   `assets/`, register `author` and `writer`, and complete an inline author
   fixture without reading developer-local configuration.
8. A clean-room integration test runs with isolated `HOME`, `XDG_CONFIG_HOME`,
   and no OMO installation to detect accidental local dependencies.
9. The reusable consultation skill treats `writer` and executable verification
   as optional host capabilities. Another agent can follow the author workflow
   inline when `consultation_dispatch`, filesystem writes, or shell execution is
   unavailable; it must report the reduced delivery or verification capability.
10. No core type names an OpenCode tool, OMO category, provider-specific model,
    or local path. Provider and host bindings remain adapter concerns.

The local Janus and writing-category configuration is design evidence only. It
is neither a runtime dependency nor a release prerequisite.

## 18. Non-goals

- Replacing the existing five modes.
- Building a general word processor or documentation CMS.
- Storing full authored documents in consultation memory.
- Giving writer or evidence subagents file-edit or shell permissions.
- Running every tutorial through full adversarial verification.
- Automatically downloading SDKs or dependencies without confirmation.
- Maintaining backward compatibility for unreleased author-schema drafts.
- Depending on OMO, Janus, host-specific category names, or developer-local
  configuration.

## 19. Acceptance criteria

The design succeeds when the consultant can:

1. Distinguish a durable-document request from research, planning, and guides.
2. Select the correct author profile and adapt to an explicitly known audience.
3. Obtain one outline approval before producing a large multi-file artifact.
4. Produce coherent files under the approved destination with a valid index.
5. Use a writing blueprint consistently across chapters.
6. Inspect source and run proportionate verification when technical correctness
   depends on it.
7. Escalate to critic/verifier only when their specialized checks are warranted.
8. Resume interrupted work without saving document bodies into memory.
9. Report exactly what was verified and what remains uncertain.
10. Leave existing mode behavior unchanged.
11. Pass an installed-artifact integration test in an isolated environment with
    no Janus, OMO, global writer agent, or development-checkout imports.
