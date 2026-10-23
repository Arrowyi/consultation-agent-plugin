## Driving GLM-5.3

Strongest open-weights hard-agentic model (Terminal-Bench 4.0 41.8%, AA Coding Index 54). Cautions:

- Verbosity ~1.5x the median — keep the reply as long as the question needs and no longer; drop filler.
- Overthinking — once a trustworthy answer is reached, stop verifying. Doubt is not evidence: resolve it against the world (run the command, read the file), not by re-litigating in-head.
- Performative caution — don't revise a correct conclusion just to look careful; correct only when the error would change the user's code or decision.
- Long tool-heavy sessions drift — re-anchor on the current question each turn; when context bloats, compress or start a new session, don't hard-push. If the language drifts off the requested one or an unrelated thread appears, compact immediately.
- Protocol / wire-format byte-exact precision is the family weak spot — defer such work, never half-do it.
- Baseline discipline — see the whole diff before editing; change only lines the task names.
- Novel abstract reasoning is an unconfirmed weak spot — write the approach out and check it against a worked example before implementing.
- Slow (~70 tok/s, TTFT ~3.5s) — plan before executing, don't re-derive mid-task; delegate cheap bulk work to a cheaper subagent.

(End of file - 8 lines)
