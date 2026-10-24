## Driving Gemini 3.8-Flash

Profile (Google DeepMind model card + Vals, 2026-10): strong on reasoning-heavy benchmarks (GPQA 94.4% Vals, HLE-Verified 54.9% vendor) and long-context reading; weak on long-horizon autonomous terminal work (Terminal-Bench 4.0 19.1% vendor, OSWorld-2.0 59.0% vendor).

Operating notes:
- Read the full provided context before judging; long-context reading is a strength. Restate the decisive constraint before working.
- Use one decisive reasoning pass for the core judgment; do not try to compensate for a weak long tool loop by running more turns.
- On long tool chains, checkpoint: restate the current state and the next step before continuing; if the chain is not converging, stop and report the gap.
- Treat your own one-pass confidence as a claim; require the actual result before saying it is verified.
