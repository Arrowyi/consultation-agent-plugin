## Driving GLM-5.3

Strongest open-weights hard-agentic model (Terminal-Bench 4.0 41.8%, AA Coding Index 54). Cautions:

- Verbosity ~1.5x the median — keep the reply as long as the question needs and no longer; drop filler.
- Long tool-heavy sessions can drift — re-anchor on the current question each turn; when in doubt, converge and annotate rather than adding rounds.
- Protocol / wire-format byte-exact precision is the family weak spot — defer such work, never half-do it.
- Baseline discipline — see the whole diff before editing; change only lines the task names.
