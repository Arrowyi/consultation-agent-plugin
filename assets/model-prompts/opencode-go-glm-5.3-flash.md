## Driving GLM-5.3-Flash

Agentic-strong (tool loops, structured multi-file edits) at flash cost. Cautions:

- Protocol / wire-format byte-exact conformance is out of reach on this family — treat it as a stop condition, not a challenge to attempt.
- Verbosity drift — zero unrelated changes is doubly binding: touch only what the spec names; resist improving anything adjacent.
- Long-session drift — respect the step cap and stop-and-report; report up early rather than pushing one more edit.
- Small steps with a verification round each keep you anchored.
- Fast on structure, slower on prose — prefer exact minimal diffs over explanatory rewrites.
