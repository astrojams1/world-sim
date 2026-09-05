# Benchmark

Fixed set: seeds 101-110 (`BENCH_SEEDS` in `scripts/bench.mjs`), `BENCH_SET_VERSION = 1`.
Model `gpt-5-mini` unless stated. Costs are estimates from list prices plus one code-interpreter session per room.

Record rule: mean score >= record + 1.0, or within 1.0 of the record with cost/room >= 20% lower.
Noise: a single 10-room run has a run-to-run spread of several points (the same room can score 56 or 91 on
different runs). A candidate record is therefore **confirmed by a second run** of the same configuration; the
record is the mean of the two runs, and both runs must pass the anti-cheat checks.

## Record

**iter2-solve-all** (confirmed) — mean 91.0 (runs: 91.1 and 90.9), 3/10 exact in both runs, 262 s/room, 16,295 tokens/room, $0.039/room. Previous record: iter0-baseline 90.0 / $0.045.

## History

| Iter | Label | Hypothesis / change | Mean | Exact | Mean s | Mean tokens | Cost/room | Verdict |
|---|---|---|---|---|---|---|---|---|
| 0 | iter0-baseline | Baseline: current prompt + helper, gpt-5-mini medium | 90.0 | 2 | 231.7 | 23,132 | $0.045 | record (baseline) |
| 1 | iter1-shape-check | Per-object silhouette shape check (sphere vs rotation-fitted cube, size re-fitted, asymmetric margin) required in the prompt; soft sub-pixel crop rendering for rotation fits (300 starts + Powell). Offline: 61/61 correct shapes kept, 38/61 wrong ones recovered; cubes within 10 deg 22/29 vs 17/29. | 87.1 | 3 | 174.2 | 22,089 | $0.044 | no record (score within noise: 107 +25, 108 -35; time -25%). Kept in tree as base for iter 2. |
| 2 | iter2-solve-all | One-shot `solve_all` (calibrate, align, pair, hypothesis, auto-explain unpaired blobs along their ray, shape check, refine) + `finish`; prompt limits the model to reconciling the inventory, max 8 cells. Offline automatic floor: 76.1 -> 90.0 (held-out 75.1 -> 84.7). | 91.1 | 3 | 243.2 | 15,160 | $0.038 | candidate |
| 2b | iter2-solve-all-confirm | Confirmation run of the same configuration. | 90.9 | 3 | 281.8 | 17,429 | $0.040 | **record** (mean 91.0, cost -13%, tokens -30%; time +13%) |
