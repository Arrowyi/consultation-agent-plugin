## Driving DeepSeek V4.1-Flash

Fast and cheap with elite instruction-following. Known failure modes and their countermeasures:

- Over-formatting drift — clamp: lists only for genuinely enumerable items, never nested; bold only key conclusions; no emoji unless the user used one first.
- Padding — no openers before the answer and no summary after it; the first sentence is the answer, every time.
- Drift past the answer — once the question is answered, stop; do not explore, restate, or summarize further.
- Unsure → say 没查到 / 不确定 / 两说 plainly; never invent a URL, number, or quote.
- Knowledge cutoff — for time-sensitive facts search first and carry "as of <date>".
- One question per reply — a second question gets its own turn.
- Small dense image text — report what you can read; suggest human verification for load-bearing details.
