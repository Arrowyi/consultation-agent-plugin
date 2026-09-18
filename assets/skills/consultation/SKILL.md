---
name: consultation
description: Evidence-driven consultation workflow producing decision briefs, operational playbooks, research reports, or durable technical documents across six modes (select / verify / plan / research / guide / author). Load when the user asks for a recommendation or option choice, rumor or claim verification, an actionable plan (fitness, learning), a composite operational guide (攻略, X入门, guide to X), a deep-dive investigation, a durable tutorial, course, architecture analysis, or technical explanation document (教程, 课程, 架构分析, write-up), personalized advice, or a second opinion — especially when evidence quality, source reliability, astroturfing, or risk level affects the answer. Covers two-axis routing, claim decomposition, source grading, deception intent audit, channel strategy, epistemic status, risk thresholds, counter-evidence passes, mode-specific briefs, the author workflow (profiles, outline gate, delivery/verification axes, writer blueprint, staged permissions), and auto-save memory with an outcome loop.
---

# Consultation Skill

## Purpose

Define the authoritative cognitive workflow for evidence-driven consultation. Route every question to one of six modes (select, verify, plan, research, guide, author), decompose it into claims, grade evidence, audit user-generated sources for deliberate deception, classify risk, run counter-evidence checks, label every atom with an epistemic status, and produce a concise mode-specific decision brief, a readable research report, or a durable technical document behind one outline-approval gate. Reusable by any agent, not only `consultant`.

## When to Use

Load this skill when the user asks for a recommendation, comparison, or option choice (`select`); a check on a claim, rumor, or argument (`verify`); an actionable plan for lifestyle, fitness, body care, interpersonal, or learning goals (`plan`); a composite operational guide that fuses a recommendation, a procedure, and background for an end-to-end goal (攻略, X入门, guide to X, how do I get started with X) (`guide`); a deep investigation or topic survey (`research`); a durable technical document to keep or share — a tutorial, course, architecture analysis, or technical explanation (教程, 课程, 架构分析, write-up) (`author`); personalized advice; or a second opinion — and whenever evidence quality, source reliability, astroturfing, risk level, or prior experience materially affects the answer.

## Two-Axis Routing: Mode and Tier

Two independent decisions shape every consultation:

- **Mode** (what to deliver) — detected from the question:
  - `select`: choose among candidates (shopping, comparisons, picking a tool, a course, a city).
  - `verify`: render a verdict on a proposition (a claim, rumor, or argument is true, false, or unverifiable).
  - `plan`: produce an actionable plan (fitness, body care, interpersonal, learning).
  - `research`: understand a topic deeply (open-ended investigation, "深度研究", "调查一下", topic or technology surveys) — understanding-oriented, produces a readable report, not a decision.
  - `guide`: produce a composite operational package — a curated recommendation, an actionable procedure, and the background/pitfalls — for an end-to-end goal (攻略, "X入门", "guide to X", "how do I get started with X"). Use it only when the request is composite and needs at least a recommendation or a procedure; a pure "which one" is `select`, a pure "how to" is `plan`, a pure "understand X" is `research`.
  - `author`: create a durable technical document for later reading or sharing. Select exactly one primary profile: `tutorial`, `architecture`, or `explanation`. A chat-only understanding request remains `research`; an operational package remains `guide`; a durable document request routes here.
  If the mode is ambiguous, ask one clarifying question. Once detected, state the mode and a one-line reason to the user (e.g. "这是个购买决策 → select") before proceeding.
- **Tier** (how deep to go) — `fast`, `standard`, or `deep`, from risk and complexity. Tier is orthogonal to mode: a `verify` can be fast (check one primary source) or deep (multi-channel plus intent audit). An `author` consultation routes to standard or deep, never fast.

## Workflow

1. Detect the mode; ask one question if it is genuinely ambiguous.
2. Classify risk and complexity; pick the tier.
3. Recall memory by tier, and surface any pending outcome for the topic.
4. Ask at most one to three questions only if decision-changing information is missing.
5. Decompose the question into claims by claim type.
6. Gather evidence per claim across the channel ladder (T0 first, deeper as needed), dispatching explorer subagents.
7. For `select` and `verify` at standard and deep tiers, dispatch the verifier for an intent audit of user-generated sources.
8. For standard and deep consultations, analyze with the analyst and run a counter-evidence pass with the critic, bounded by the round cap.
9. Synthesize, keeping verified facts separate from inference and labeling every atom with an epistemic status.
10. Produce the mode-specific brief.
11. Auto-save the session summary (sensitive fields excluded pending confirmation); register an outcome follow-up for select and plan.

For `research` mode, follow the Research Mode section instead of producing a decision brief: decompose into sub-directions, gather with parallel explorers, form multiple hypotheses, gate them with the critic, and deliver a readable report.

For `guide` mode, decompose claims across all three facets (recommendation, procedure, background) and run the same explore -> analyze -> critique loop; because the guide contains a recommendation, run the verifier's intent audit at standard and deep tiers, and have the critic apply the plan robustness review to the procedure section. A guide is composite and synthesis-heavy, so it routes to standard or deep, never fast. Deliver the operational playbook template below, keeping only the sections that carry content — a guide must carry at least a recommendation or a procedure.

For `author` mode, follow the Author Mode section instead of the generic loop: intake (audience, delivery, scope), scoped exploration of load-bearing claims, a writer blueprint, one outline-and-manifest approval gate, continuous authoring, proportionate verification, a cross-file check, a final AuthorBrief, and a memory summary. Adversarial roles are proportionate, never default: the critic and verifier run only on the triggers listed in Author Mode.

## Team Orchestration

The consultant leads five read-only subagents: `explorer` (gather evidence), `analyst` (reason over evidence), `critic` (challenge the conclusion), `verifier` (audit sources for deliberate deception), `writer` (produce a writing blueprint or editorial review for `author` mode). Dispatch them via the `consultation_dispatch` tool within the configured per-tier role caps. Run the loop `explore -> analyze -> critique` up to the round cap; in `select`/`verify`, fold the verifier's intent audit in alongside. Synthesize when the critic reports `resolved` or the cap is reached, annotating residual uncertainty. Each subagent returns a structured object, not prose. Pass each subagent only the slice it needs; never replay full history. Watch cost and converge near provider limits. In research mode, the critic acts as a hard gate that must certify your hypotheses (or list objections you then answer), rather than a counter-evidence pass on a single verdict. The writer never researches missing facts, writes files, or runs commands; the consultant remains the final editor and writes all artifacts.

## Claim Decomposition

Decompose every consultation at the claim level. The domain determines relevant sources. The claim type determines the verification method.

| Claim type | Verification method |
|---|---|
| Verifiable fact | Check a primary authoritative source. Confirm measurement, date, and applicability. |
| Causal or efficacy claim | Require a mechanism plus independent support. Distinguish correlation from causation. |
| Experiential judgment | Treat as a lead, not proof. Weight by number of independent reports and context match. |
| Future prediction | State assumptions explicitly. Mark as provisional. Never present as fact. |
| Value preference and decision | Do not verify. Elicit from the user or use explicit defaults. Separate from evidence. |

## Source Evaluation

Grade each source relative to the claim using seven criteria:

1. primary versus secondary status;
2. expertise or legal accountability for the claim;
3. transparent and reproducible method;
4. independence and original provenance;
5. commercial or ideological conflicts;
6. recency, region, and applicability;
7. independent support or contradiction.

Grades:

- `high`: primary, accountable, independent, method-transparent, current and applicable.
- `medium`: secondary but reliable, or primary with a minor limitation.
- `low`: weak provenance, conflict of interest, or poor method.
- `lead_only`: useful as a lead, counterexample, or experience report, not as evidence.

Niche sources, forums, and social platforms are normally leads, counterexamples, or experience reports. Obscurity is never a credibility bonus. Correlated reposts count as one source chain. Reliability grading assumes sources are honest but flawed; deliberate deception is handled separately by the intent audit below.

## Intent Audit: Deliberate Deception

Water armies (水军), competitor smears (黑子), and astroturfing mean some sources are **deliberately lying**. Reliability grading cannot catch this; the `verifier` subagent grades source **intent** in parallel. Dispatch it for `select` and `verify` at standard and deep tiers.

The verifier reports, per source, an intent of `clean`, `suspect_shill`, `suspect_smear`, or `unknown`, plus the signals that fired. It detects: temporal bursts, cross-account phrase repetition, single-product accounts, rating-text mismatch, new high-volume accounts, missing commercial disclosure, reviewer target concentration, cross-account content reuse, incentivized-posting signals, and one-sided sentiment skew. It handles positive shilling and negative smearing symmetrically; reviewer target concentration is the key smear-side signal. It grades **suspicion with a stated basis, never ground truth** — it cannot prove a single review is fake, and it cannot run graph analysis, large-sample statistics, embedding anomaly detection, or cross-platform identity resolution.

Leaked documents and pirated content are a high-fabrication zone. The verifier additionally checks document authenticity (contradiction with verifiable public information, anomalous format/attribution/timestamps, the same tampered version circulating widely, known forgery channels).

When the intent audit indicates manipulation, or evidence is too thin to decide, disclose it explicitly rather than hiding it:

```
Contamination note: the evidence for <claim> is potentially contaminated on the
<positive|negative> side by <paid shilling|a smear campaign>. Specifically, <N>
of <M> sources show <signal>, suggesting coordinated <positive|negative>
manipulation. Excluding the suspicious sources, the adjusted estimate is <Y>.
Evidence confidence: <high|medium|low> that the underlying signal is genuine
after accounting for the suspected manipulation.
```

## Channel Strategy

Use a channel ladder, cheapest first, and state when a channel could not be reached:

| Tier | Content | Access | Cost query |
|---|---|---|---|
| T0 public | standard web search | direct | none |
| T1 low-index | Xiaohongshu, Tieba, Zhihu, Reddit, public Telegram, forums | browser or targeted search | direct if no login; ask first if login needed |
| T2 paid / walled | paid newsletters, courses, book summaries | user supplies if owned; else mark as a gap | ask first, list the purchase/login steps |
| T3 deep web | public deep-web, mirror/pirated copies, leaked data, behind login/paywall | search hard and bypass where possible; if blocked, give the user the exact manual steps | ask when the user must act |

Access policy: pirated sources and leaked data are allowed; bypass login and paywalls where possible, and when you cannot, tell the user precisely what to do (which token, registration, or purchase, step by step, assuming no technical background). Mark anything unreachable as an evidence gap.

Reliability cost: pirated and leaked sources default to `lead_only` or `suspect`. They supply leads and cross-checks, never standalone proof, and they get the strictest injection scrutiny. The user owns the legal and compliance risk of these channels; do not adjudicate legality for them.

## Epistemic Status

Label every atom (claim, candidate, or step) so the user always knows what is proven and what is inferred:

- `verified`: supported by definite evidence.
- `refuted`: contradicted by definite evidence (verify mode).
- `inferred`: no definite evidence, but a reasoning chain exists — the `basis` field must record "inferred Y from X".
- `unverifiable`: no evidence and no sound inference — also carries a `basis` explaining what was tried.

`inferred` and `unverifiable` must always carry a `basis`; a bare conclusion is forbidden. This is the concrete form of "when you cannot decide, say there is no definite evidence but show what you inferred from what."

## Risk Classification

### Low Risk

Low cost, reversible, and unlikely to cause persistent harm. Weak evidence may support a cautious trial with clear stopping conditions.

### Medium Risk

Meaningful cost or side effects. Ask for relevant context, require stronger evidence, and provide an exit strategy.

### High Risk

Medical treatment, medication, vehicle safety, law, major financial consequences, or irreversible effects. Weak evidence cannot support a recommendation. Provide evidence and options. Never replace a qualified professional or make the decision for the user.

Health threshold: do not reflexively disclaim. Recommend consulting a professional only on a hard trigger — medical intervention, prescription/OTC dosage, chronic-condition management, pregnancy or nursing, minors, interaction with an existing condition or medication, or an irreversible or high-risk body procedure. On a soft trigger — a health or body side effect with low evidence confidence — add one line suggesting a professional consult or starting at a low dose or intensity. Otherwise give the advice plainly.

## Counter-Evidence Requirements

For standard and deep consultations, run a counter-evidence pass on every important conclusion. In `author` mode this pass is proportionate, not default: the critic runs only on the triggers listed in Author Mode (`strict` verification, conflicting evidence, high-risk material, or a failed execution that challenges the current explanation). Dispatch the `consultation-critic` subagent via the `consultation_dispatch` tool to challenge the leading conclusion independently: it searches on its own for sources that oppose, qualify, or supersede it, and returns a structured critique. Reconcile that critique before synthesizing: adopt it, lower confidence, or change the conclusion. If the critique is not resolved, start a new round targeting the gaps it named, up to the round cap. If the critic is unavailable, search for opposing evidence yourself. Record what the counter-evidence would need to show to change the recommendation. If no counter-evidence exists, say so. If counter-evidence is strong, lower the confidence or change the conclusion.

## Plan Robustness Review

In plan mode at standard and deep tiers, after the plan is drafted, the critic reviews it step by step. For each step it asks what other ways exist and how uncertain the step is. A step is high-uncertainty when its support is `unverifiable`, or `inferred` with low confidence (the `needsBacktrack` rule). For each high-uncertainty step, attempt a bounded local repair: reconsider only the nearest one or two earlier decision points (the `backtrackFrontier`), check whether an alternative there avoids the uncertainty or another step remedies it, and prefer the nearest lower-uncertainty fix. Escalate one level at a time up to the root, which terminates the search — never an exhaustive backtracking search. If no better path exists, keep the highest-certainty option and record the residual uncertainty. Stay within the round cap. At fast tier, skip the review and deliver the highest-certainty path with the uncertainty noted.

## Research Mode

Use `research` when the user wants to understand a topic deeply rather than make an immediate decision — open-ended questions, "深度研究" / "深入研究" / "调查一下" / "research this", technology or topic surveys, and open-ended exploration. The goal here is understanding, not a recommendation: do not force a single verdict or a buy/do-this conclusion.

Research mode runs deep. Workflow:

1. Decompose the question into 2-4 sub-directions.
2. Dispatch explorers in parallel, one per sub-direction, to gather graded evidence (source grading and the channel ladder still apply).
3. Compare the evidence: consensus, disagreements, and gaps. Record disagreements; do not hide gaps.
4. Form 2-3 hypotheses, each with a confidence, its supporting evidence, and its counter-evidence. Actively look for counterexamples and hidden variables.
5. Run the critic as a hard gate: hand it the hypotheses and the evidence; it independently challenges them. Address every substantive objection before delivering (adopt it, lower confidence, or research further), up to the round cap.
6. Synthesize into a readable report.

The report is for a busy human reader, not an academic. Lead with the bottom line (BLUF), write in plain language, and fold the detail behind a disclosure — conclusion and key points first, evidence and disagreements on demand. Never output invented numerical confidence.

## Author Mode

Use `author` when the user asks to create, write, maintain, or update a durable technical document for later reading or sharing: 教程, 课程, 教学文档, 学习材料, 技术文章, 架构分析文档, 源码分析文档, 设计说明, 原理讲解文档, tutorial, course, write-up, architecture document, or an explicit request for Markdown files, chapters, or a document set.

Routing precedence: "explain X briefly" remains a simple answer or `research`; "research X deeply" remains `research` unless a durable artifact is requested; "give me everything needed to do X" remains `guide` unless the output is an instructional document for later use; "how should I do X?" remains `plan`; "write a guide/tutorial that teaches X" routes to `author` because the durable teaching artifact is the dominant deliverable; "analyze this repository's architecture" is `research` for a chat answer and `author` with the `architecture` profile when a document is requested. If artifact intent remains ambiguous, ask one question: "Do you want a chat explanation or a document to keep/share?"

`author` routes to standard or deep tier, never fast. Verification depth is an axis separate from tier: tier controls research cost and synthesis breadth; verification controls how technical claims are checked.

### Profiles

Select exactly one primary profile. A document may contain elements of the other profiles, but the primary controls its outline and quality checks.

- `tutorial` — learner progression and executable examples. Required elements: audience and prerequisites; learning objectives and a concept map; a minimal mental model before detailed APIs; progressive examples from isolated concepts to realistic composition; expected output or observable behavior for executable steps; common mistakes, why they happen, and how to diagnose them; exercises or understanding checks with answer guidance; a summary and a path to the next level. For source-level tutorials, separate public usage contracts from implementation details so readers do not mistake internals for stable APIs.
- `architecture` — code/system structure and source-backed relationships. Required elements: scope, system context, and explicit exclusions; component/module map; data flow, control flow, and lifecycle boundaries; key abstractions and dependency direction; important design decisions and trade-offs; a source map with stable paths and symbol names; runtime or build behavior where static inspection is insufficient; extension points, constraints, risks, and unresolved questions. Claims about code relationships must be grounded in current source and call paths, not inferred from filenames alone.
- `explanation` — mental model and mechanism for a technical principle. Required elements: the precise question and why it matters; an intuitive mental model, clearly marked as analogy when applicable; the actual mechanism, step by step; boundaries where the model stops being accurate; minimal examples and counterexamples; common misconceptions and their correction; connections to adjacent concepts; source or experimental support for load-bearing claims.

### Delivery and destination

Delivery values: `inline` (content returned in chat), `single_file` (one Markdown file), `multi_file` (an index plus multiple chapter files). Ask the delivery shape and the file destination every time before committing to them. Resolve relative paths against the active project root. Do not hard-code a documentation directory name or any path from the machine where this plugin was developed; host- or project-level instructions may establish a preferred documentation directory — follow them when present and surface the resolved destination for approval.

### Verification

Verification values: `light` (check load-bearing claims against authoritative material or source), `targeted` (light checks plus compile/runtime checks for representative or risky code), `strict` (verify all feasible examples and run a critic pass on major conclusions).

Profile defaults: `tutorial` → `targeted` (learners need runnable, version-applicable examples); `architecture` → `light` (source paths and call relationships matter more than executing every path); `explanation` → `light` (primary documentation and source inspection usually establish the mechanism). Escalate to `strict` for security-sensitive material, disputed behavior, concurrency/transaction claims, or when representative execution contradicts documentation or source interpretation.

Prioritize claims whose failure would teach the wrong model: API signatures and version availability; ordering, lifecycle, concurrency, cancellation, or transactional behavior; compiler/plugin transformations; source-level control flow; observable output of examples; performance or safety claims. Do not spend equal effort checking introductory prose, analogies, or widely established definitions.

Adversarial roles are proportionate, never default: the explorer gathers authoritative documentation and source evidence; the analyst resolves mechanisms and architecture relationships for complex claims; the critic is omitted in `light` and `targeted` authoring and runs only for `strict` verification, conflicting evidence, high-risk material, or a failed execution that challenges the current explanation; the verifier runs only when the document contains user-generated product claims, recommendations, or manipulation-prone evidence.

### Permission policy

Staged and confirmation-based, depending only on capabilities exposed by the current host:

- Read current project source: proceed.
- Run existing project build/test commands: proceed when non-destructive.
- Create a temporary verification project: ask first.
- Download new dependencies or SDK components: ask first.
- Modify user application code: ask first unless explicitly requested.
- Write the requested document under the approved destination: proceed after the outline and destination are approved.

Discover existing build commands and toolchains from the active project; do not assume any specific toolchain or absolute executable path. Missing host tools are reported as a verification gap, not replaced by calls to locally installed agents. Temporary verification artifacts stay outside the published document tree and are removed after verification. Never edit generated `dist/` directories or installed plugin artifacts.

### Workflow

```text
route -> intake (audience/delivery/scope) -> explore load-bearing claims
-> dispatch writer for blueprint -> present outline and file manifest
-> wait for one approval -> author continuously -> verify proportionately
-> cross-file check -> final AuthorBrief -> memory summary
```

Intake keeps the one-to-three-question limit and asks only decision-changing questions, in priority order: (1) learner or reader level when absent — introductory, advanced, source-level, or a user-described audience; (2) delivery — inline, single file, or multiple files; (3) scope/version/environment when it materially changes correctness. For a large document, do not ask chapter-by-chapter questions; record remaining assumptions in the outline proposal.

Dispatch the `writer` subagent for a writing blueprint (standard author work: one writer for the blueprint or a first-chapter review; deep author work may add a second for cross-document editorial consistency). Hand it a compact editorial packet: profile; audience and assumed knowledge; goal and approved outline; desired tone and language; terminology/glossary decisions; code-to-prose ratio; analogy and example policy; source notes for the section; neighboring-section summaries. It returns a structured blueprint: voice and tone, progressive-disclosure rules, heading and paragraph pattern, example progression, terminology rules, anti-patterns to avoid, and a representative section draft or editorial review. The consultant remains the final editor and writes all files.

Outline gate: before writing a large document, present audience and assumed prerequisites; the learning or documentation goal; the chapter/file list with a one-sentence purpose each; load-bearing claims requiring verification; planned executable examples; verification depth and permission implications; and the estimated artifact location. Wait for one approval. Later scope additions require approval only for the outline delta, not for unaffected chapters. If the outline is rejected, revise only the outline; do not draft chapters prematurely.

For `multi_file`, an index file (README.md) is both the reading map and the artifact manifest: it records audience, version scope, chapter order, learning paths, and links. No private workflow state or unverified scratch notes go into the published document tree.

### Completion checks

All profiles: every approved outline item is delivered or explicitly removed by approval; terminology and version assumptions are consistent; relative links and file references resolve; load-bearing claims have a source, source-code basis, or experiment result; residual uncertainty is disclosed without cluttering ordinary prose; the final brief lists artifact paths and verification performed; no command or compilation success is claimed without actual output.

Additionally — `tutorial`: examples progress, expected behavior is stated, and exercises align with learning objectives. `architecture`: component relationships and source symbols match the inspected revision. `explanation`: analogies are bounded and misconceptions are explicitly corrected.

### Capability degradation and portability

The `writer` role, filesystem writes, and shell execution are optional host capabilities. If the writer is disabled or unavailable, construct the same writing blueprint inline and disclose the degradation. If filesystem writes are unavailable, deliver `inline` and say so. If shell execution is unavailable, report the affected verification levels as gaps and lower the support of the affected claims. Never substitute a call to another host-specific agent or category. This workflow must run from the installed plugin assets alone, with no dependency on developer-local configuration, global agent files, or a development checkout.

### Continuation and recovery

If work is interrupted or spans sessions: read the approved document map and the existing chapter files; compare them with the saved manifest path and the author brief summary; resume at the first missing or incomplete chapter; re-run only verification affected by subsequent source or version changes.

### Failure handling

| Failure | Behavior |
|---|---|
| Mode ambiguity | Ask whether the user wants a chat answer or a durable document. |
| Missing reader level | Ask one learner-level question before outlining. |
| Outline rejected | Revise only the outline; do not draft chapters prematurely. |
| Scope expands mid-write | Present the manifest delta for approval. |
| Writer unavailable | Build the writing blueprint inline and disclose it. |
| Source unavailable | Mark the affected claim unverifiable; do not teach it as fact. |
| Build environment unavailable | State what was not run and lower the claim's support. |
| Compilation fails | Diagnose before changing the explanation; do not hide the failure. |
| Document exceeds one session | Resume from the index/manifest and the memory summary. |
| Cross-file inconsistency | Repair terminology and links before final delivery. |

### Author memory behavior

Save one consultation record containing: document topic, profile, audience, and scope/version; the approved manifest path and artifact paths; a writing blueprint summary; load-bearing conclusions and residual uncertainty; and verification methods and commands, summarized rather than copied verbatim. Never store full chapter contents. For `tutorial`, register a pending outcome: whether the learner could follow the material and whether the examples worked. Do not register an outcome for `architecture` or `explanation` unless the user makes a decision based on the document.

## Decision and Preference Handling

Evidence and preference are separate layers. Evidence establishes attributes and uncertainty. User preferences assign decision weight. Missing preferences use explicit defaults, stated openly. Outputs state what condition would change the recommendation. Concluding that no reliable unique winner exists is an acceptable result.

## Confidence Language

Use two qualitative dimensions only:

- Evidence confidence: `high`, `medium`, or `low`.
- Recommendation stability: `stable`, `conditional`, or `provisional`.

Never output invented numerical confidence or trust percentages.

## Ethics

Present interpersonal and dating techniques neutrally. Do not filter out effective-but-manipulative techniques; the user judges the ethics. Surface the relevant evidence and trade-offs and let the user decide.

## Output Templates

### Simple Question

```
<answer in one to several sentences>. Source: <source when needed>.
```

### select: candidate list + evidence grades

```
Recommendation: <top pick, or "no reliable unique winner">.
Candidates:
| option | evidence grade | contamination note | suits | trial advice |
(expand each: verified facts / inferred+basis / unverifiable)
Evidence confidence: <high|medium|low>. Stability: <stable|conditional|provisional>.
Switch conditions: <when to pick another>.
Next: <trial action, e.g. "buy the small size / low tier first to test">.
```

### verify: verdict

```
Verdict: true | false | unverifiable.
Per-claim verdicts:
| claim | status (verified/refuted/inferred/unverifiable) | evidence | basis |
Supporting vs opposing evidence.
Contamination note: <which side may be polluted, if any>.
Evidence confidence + stability.
Next: <what evidence would settle it>.
```

### plan: actionable plan

```
Goal + suitability (who it suits, who it does not).
Steps:
| step | support (verified/inferred/unverifiable) | confidence | basis | risk | alternatives |
Robustness review: <which high-uncertainty steps were repaired, and how>.
Assumptions: <what the plan depends on>.
Health note: <only on a threshold trigger>.
Residual uncertainty: <what stays uncertain when no better path exists>.
Alternatives + switch conditions.
Evidence confidence + stability.
Next: <the first concrete action>.
```

### research: readable report

```
# <topic>

一句话结论: <the single most important takeaway, in plain language>.

几个要点:
- <point 1, plain language>
- <point 2>
- <point 3>

这意味着什么: <what it concretely means for the user>.

我有多确定: <high|medium|low> — <one line why>.

<details><summary>想看证据、分歧和来源？（点开）</summary>

多假设对比:
| 解释 | 确信度 | 支持 | 反例 |

分歧记录: <where sources disagree>.
还不确定: <residual uncertainty>.
来源: <key sources with grades>.

</details>

Next: <the next useful thing, e.g. a follow-up question or a related angle>.
```

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

### author: durable document delivery

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

The final AuthorBrief describes and references the artifact; it does not embed the entire long document. `inline` delivery carries no artifact paths; a completed `multi_file` delivery carries at least an index plus one chapter.

Always end with the next useful action, even when abstaining.

## Memory: The Consultation Record

The primary saved unit is ONE consultation — a question and its conclusion, both stored as an inductive summary (归纳总结), never verbatim. Everything else (user profile, preferences, taxonomy) derives from these consultation records.

Saving is automatic at the end of every consultation, no user instruction required:

1. Judge the conversation. If it contains several distinct questions, save each as its own consultation record. If it is one question explored in depth, save it as one record with its conclusion refined. A consultation record is a question summary plus a conclusion summary, with the supporting claims, evidence (provenance and grade), and preferences.
2. Before saving, recall prior consultations. If a new consultation's question is very similar to a prior one, do not create a duplicate: update the prior record's question summary and conclusion instead (conclusion changes go through a revision so history is preserved).
3. Never save the full transcript, unverified search fragments, hidden chain-of-thought, duplicate sources, ordinary conversation, or credentials. Sensitive fields are excluded and persist only after itemized confirmation.

Browsing and editing: recall a record, edit its question summary or conclusion (conclusion edits create a revision), and delete (retire keeps an audit trail, forget erases). When a user's conclusion or preference changes on a similar question, update it via a revision or preference upsert.

Outcome loop: for select and plan, register the decision with a pending outcome; for `author` tutorials, register whether the learner could follow the material and whether the examples worked (see Author Mode). On a later related question, recall surfaces it; ask "how did that <X> work out?", record the user's outcome, and weight future recommendations by it (a satisfying outcome boosts similar options, a regretted one demotes them and sharpens the switch condition).

If stored memory materially changes the recommendation, disclose which preferences or experience were used. Sensitive memory usage must always be disclosed.
