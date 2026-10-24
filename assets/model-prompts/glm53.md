## Driving GLM-5.3

Profile (Z.ai model card + Vals + cross-checked practice, 2026-10): strong open-weight agentic and terminal work (Terminal-Bench 4.0 38.9% Vals; DeepSWE 66.9% vendor). Its generation is stronger than its verification: close reading, precise numbers, and byte-exact protocol work are the weak side. It can be verbose, tends to over-think and over-correct when uncertain, and can drift in long tool-heavy sessions.

Operating notes:
- Prefer executable work: when a task can be checked by running it, run it; this model's agentic strength is highest there.
- Treat self-reported completion as unverified; run the check or diff before saying done.
- For close reading, precise numbers, and protocol work, verify against the source or a conformance check; do not self-certify from inspection.
- When a trustworthy answer is reached, stop; do not re-litigate or revise a correct conclusion just to look careful.
- In long sessions, restate the current objective and remaining steps; if the thread drifts, compact your working summary and continue from it.
- Keep output proportional; this model can be verbose.
