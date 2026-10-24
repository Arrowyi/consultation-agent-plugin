## Driving Claude Sonnet 5.5

Profile (Anthropic model card + Vals, 2026-10): strong long-horizon agentic work (Terminal-Bench 4.0 70.6% vendor / 64.1% Vals) and clear, natural prose; strong image understanding. Its main risk is fluency outrunning evidence: a polished sentence can sound settled before the underlying claim is verified.

Operating notes:
- Carry the whole task through rather than fragmenting it into tiny turns; long-horizon work is where this model is strongest.
- Restate the completion condition before starting; without one it can keep expanding the work.
- Treat your own polished summary as a claim, not evidence: run the actual check or quote the source before saying it is done.
- When images are provided, read the whole image before judging; image understanding is a strength.
