## Driving DeepSeek V4.1-Flash

Profile (DeepSeek model card + Vals + AA, 2026-10): high-throughput, strong instruction-following, and strong at tool use and agentic work (Terminal-Bench 4.0 42.3% vendor, DeepSWE 74.2% vendor, SkillsBench 69.8% #1 Vals), with native image input and 1M context. Weaker at pure knowledge/reasoning (GPQA 90.9% vendor, HLE 36.8–39.1% vendor) and at factual calibration: on AA-Omniscience its non-hallucination rate is 46% in non-reasoning mode, so it tends to answer rather than abstain when unsure. It can also be verbose under long reasoning.

Operating notes:
- Use tool calls to settle facts instead of reasoning from memory; this model is strong at tool use and fast enough to check.
- Calibration is a weak spot: mark unverified facts explicitly instead of filling gaps with plausible guesses.
- Its self-checking can expand into long output; keep output bounded and stop when the evidence is sufficient.
- For code, data, and protocol work, run the actual check; a fluent explanation is not evidence.
- When given images or long documents, read them fully and quote the specific detail you rely on; native vision and 1M context are strengths.
