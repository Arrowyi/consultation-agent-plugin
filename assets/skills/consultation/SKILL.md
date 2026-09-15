---
name: consultation
description: Evidence-driven consultation workflow for answering questions and producing decision briefs, operational playbooks, or readable research reports across five modes (select / verify / plan / research / guide). Load when the user asks for a recommendation, comparison, product or option choice, rumor or claim verification, an actionable plan (lifestyle, fitness, learning, interpersonal), a composite end-to-end operational guide (攻略, X入门, guide to X, how do I get started with X), a deep-dive investigation or topic survey, personalized advice, or a second opinion — especially when evidence quality, source reliability, astroturfing, risk level, or prior experience materially affects the answer. Covers two-axis routing, claim decomposition, source grading, deliberate-deception intent audit, hidden-channel strategy, epistemic status labels, risk thresholds, counter-evidence passes, mode-specific decision briefs and research reports, and auto-save memory with an outcome loop.
---

# Consultation Skill

## Purpose

Define the authoritative cognitive workflow for evidence-driven consultation. Route every question to one of four modes (select, verify, plan, research), decompose it into claims, grade evidence, audit user-generated sources for deliberate deception, classify risk, run counter-evidence checks, label every atom with an epistemic status, and produce a concise mode-specific decision brief or a readable research report. Reusable by any agent, not only `consultant`.

## When to Use

Load this skill when the user asks for a recommendation, comparison, or option choice (`select`); a check on a claim, rumor, or argument (`verify`); an actionable plan for lifestyle, fitness, body care, interpersonal, or learning goals (`plan`); a composite operational guide that fuses a recommendation, a procedure, and background for an end-to-end goal (攻略, X入门, guide to X, how do I get started with X) (`guide`); a deep investigation or topic survey (`research`); personalized advice; or a second opinion — and whenever evidence quality, source reliability, astroturfing, risk level, or prior experience materially affects the answer.

## Two-Axis Routing: Mode and Tier

Two independent decisions shape every consultation:

- **Mode** (what to deliver) — detected from the question:
  - `select`: choose among candidates (shopping, comparisons, picking a tool, a course, a city).
  - `verify`: render a verdict on a proposition (a claim, rumor, or argument is true, false, or unverifiable).
  - `plan`: produce an actionable plan (fitness, body care, interpersonal, learning).
  - `research`: understand a topic deeply (open-ended investigation, "深度研究", "调查一下", topic or technology surveys) — understanding-oriented, produces a readable report, not a decision.
  - `guide`: produce a composite operational package — a curated recommendation, an actionable procedure, and the background/pitfalls — for an end-to-end goal (攻略, "X入门", "guide to X", "how do I get started with X"). Use it only when the request is composite and needs at least a recommendation or a procedure; a pure "which one" is `select`, a pure "how to" is `plan`, a pure "understand X" is `research`.
  If the mode is ambiguous, ask one clarifying question. Once detected, state the mode and a one-line reason to the user (e.g. "这是个购买决策 → select") before proceeding.
- **Tier** (how deep to go) — `fast`, `standard`, or `deep`, from risk and complexity. Tier is orthogonal to mode: a `verify` can be fast (check one primary source) or deep (multi-channel plus intent audit).

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

## Team Orchestration

The consultant leads four read-only subagents: `explorer` (gather evidence), `analyst` (reason over evidence), `critic` (challenge the conclusion), `verifier` (audit sources for deliberate deception). Dispatch them via the `consultation_dispatch` tool within the configured per-tier role caps. Run the loop `explore -> analyze -> critique` up to the round cap; in `select`/`verify`, fold the verifier's intent audit in alongside. Synthesize when the critic reports `resolved` or the cap is reached, annotating residual uncertainty. Each subagent returns a structured object, not prose. Pass each subagent only the slice it needs; never replay full history. Watch cost and converge near provider limits. In research mode, the critic acts as a hard gate that must certify your hypotheses (or list objections you then answer), rather than a counter-evidence pass on a single verdict.

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

For standard and deep consultations, run a counter-evidence pass on every important conclusion. Dispatch the `consultation-critic` subagent via the `consultation_dispatch` tool to challenge the leading conclusion independently: it searches on its own for sources that oppose, qualify, or supersede it, and returns a structured critique. Reconcile that critique before synthesizing: adopt it, lower confidence, or change the conclusion. If the critique is not resolved, start a new round targeting the gaps it named, up to the round cap. If the critic is unavailable, search for opposing evidence yourself. Record what the counter-evidence would need to show to change the recommendation. If no counter-evidence exists, say so. If counter-evidence is strong, lower the confidence or change the conclusion.

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

Always end with the next useful action, even when abstaining.

## Memory: The Consultation Record

The primary saved unit is ONE consultation — a question and its conclusion, both stored as an inductive summary (归纳总结), never verbatim. Everything else (user profile, preferences, taxonomy) derives from these consultation records.

Saving is automatic at the end of every consultation, no user instruction required:

1. Judge the conversation. If it contains several distinct questions, save each as its own consultation record. If it is one question explored in depth, save it as one record with its conclusion refined. A consultation record is a question summary plus a conclusion summary, with the supporting claims, evidence (provenance and grade), and preferences.
2. Before saving, recall prior consultations. If a new consultation's question is very similar to a prior one, do not create a duplicate: update the prior record's question summary and conclusion instead (conclusion changes go through a revision so history is preserved).
3. Never save the full transcript, unverified search fragments, hidden chain-of-thought, duplicate sources, ordinary conversation, or credentials. Sensitive fields are excluded and persist only after itemized confirmation.

Browsing and editing: recall a record, edit its question summary or conclusion (conclusion edits create a revision), and delete (retire keeps an audit trail, forget erases). When a user's conclusion or preference changes on a similar question, update it via a revision or preference upsert.

Outcome loop: for select and plan, register the decision with a pending outcome. On a later related question, recall surfaces it; ask "how did that <X> work out?", record the user's outcome, and weight future recommendations by it (a satisfying outcome boosts similar options, a regretted one demotes them and sharpens the switch condition).

If stored memory materially changes the recommendation, disclose which preferences or experience were used. Sensitive memory usage must always be disclosed.
