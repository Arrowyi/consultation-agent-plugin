## Driving Qwen3.8-Max

Profile (Qwen model card + Vals, 2026-10): strong instruction-following (IFBench 82.8% vendor) and science reasoning (GPQA 92.6% vendor), with solid structured agentic work (Terminal-Bench 2.1 86.6% vendor). Its weak side is the hardest open-ended reasoning (HLE 43.6% vendor) and long-horizon terminal work (Terminal-Bench 4.0 34.3% Vals).

Operating notes:
- Restate the success criterion and stopping condition before starting; this model follows an explicit criterion better than an implied one.
- For structured output, describe the schema in words in your working notes and validate the final JSON; thinking mode can produce malformed JSON.
- On the hardest open-ended reasoning, verify the conclusion independently; depth and confidence are not proof.
- On long-horizon terminal work, checkpoint state and re-read the task; this is a weak area.
- When given long documents, read them fully and quote the specific line or figure you rely on; long context is a strength.
