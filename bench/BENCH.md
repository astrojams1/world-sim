# Benchmark

Fixed set: seeds 101-110 (`BENCH_SEEDS` in `scripts/bench.mjs`), `BENCH_SET_VERSION = 1`.
Model `gpt-5-mini` unless stated. Costs are estimates from list prices plus one code-interpreter session per room.

Record rule: mean score >= record + 1.0, or within 1.0 of the record with cost/room >= 20% lower, or within 1.0 of
the record with time/room >= 30% lower (time, tokens and cost are all objectives).
Noise: a single 10-room run has a run-to-run spread of several points (the same room can score 56 or 91 on
different runs). A candidate record is therefore **confirmed by a second run** of the same configuration; the
record is the mean of the two runs, and both runs must pass the anti-cheat checks.

## Record

**iter7-shading-tiebreak** (confirmed) — mean **94.25** (runs: 95.8 and 92.7), 4 and 3 exact, 89 s/room, 15,566 tokens/room, $0.039/room. Previous records: iter4-verbatim-output 91.85 / 93 s / $0.0395; iter2-solve-all 91.0 / 262 s / $0.039; iter0-baseline 90.0 / 232 s / $0.045.

## History

| Iter | Label | Hypothesis / change | Mean | Exact | Mean s | Mean tokens | Cost/room | Verdict |
|---|---|---|---|---|---|---|---|---|
| 0 | iter0-baseline | Baseline: current prompt + helper, gpt-5-mini medium | 90.0 | 2 | 231.7 | 23,132 | $0.045 | record (baseline) |
| 1 | iter1-shape-check | Per-object silhouette shape check (sphere vs rotation-fitted cube, size re-fitted, asymmetric margin) required in the prompt; soft sub-pixel crop rendering for rotation fits (300 starts + Powell). Offline: 61/61 correct shapes kept, 38/61 wrong ones recovered; cubes within 10 deg 22/29 vs 17/29. | 87.1 | 3 | 174.2 | 22,089 | $0.044 | no record (score within noise: 107 +25, 108 -35; time -25%). Kept in tree as base for iter 2. |
| 2 | iter2-solve-all | One-shot `solve_all` (calibrate, align, pair, hypothesis, auto-explain unpaired blobs along their ray, shape check, refine) + `finish`; prompt limits the model to reconciling the inventory, max 8 cells. Offline automatic floor: 76.1 -> 90.0 (held-out 75.1 -> 84.7). | 91.1 | 3 | 243.2 | 15,160 | $0.038 | candidate |
| 2b | iter2-solve-all-confirm | Confirmation run of the same configuration. | 90.9 | 3 | 281.8 | 17,429 | $0.040 | **record** (mean 91.0, cost -13%, tokens -30%; time +13%) |
| 3 | iter3-fast-helper | Helper only: position/size search scored per object on sub-pixel silhouettes vs the residual of the other objects (was scene-wide compare); blobs under 150 px ignored; pairing capped to the 6 largest blobs per colour (held-out room 206 had 40 fragments and never finished). Offline automatic pipeline: 12 s/room (was 42-61 s), score unchanged. | 90.8 | 4 | 94.7 | 16,809 | $0.040 | candidate (time -64%) |
| 3b | iter3-fast-helper-confirm | Confirmation run of iteration 3. | 87.5 | 4 | 89.2 | 16,373 | $0.040 | no record (mean of both runs 89.2 vs 91.0; time -66%). Kept in tree unmerged as the base for iteration 4. |
| 4 | iter4-verbatim-output | Prompt only (on top of iteration 3's helper): shape verdicts are final (never cube->sphere; sphere->cube only with straight edges visible in both images), never type or edit numbers, output the last finish() JSON verbatim, 6-cell cap. | 92.7 | 5 | 97.1 | 17,128 | $0.040 | candidate (score +1.7, time -63%) |
| 4b | iter4-verbatim-output-confirm | Confirmation run. Room 108's first attempt was rejected by OpenAI as an "Invalid prompt" (moderation false positive on the unchanged prompt); it was re-run alone (`iter4-confirm-108-rerun`, 81.6) and substituted. The bench now retries API-side errors once. | 91.0 | 4 | 89.1 | 15,339 | $0.039 | **record** (two-run mean 91.85, time -64%) |
| 5 | iter5-small-cube-margin | Helper only: wall-margin clamp rounds inward to the grid (no more 0.223/0.875); the margin a cube must win by in the shape check scales with object size (half for 0.10 objects). Offline: bench 89.9 -> 90.9, held-out 91.0 -> 91.5. | 93.0 | 3 | 90.7 | 16,886 | $0.040 | candidate (score +1.15) |
| 5b | iter5-small-cube-margin-confirm | Confirmation run. | 91.7 | 2 | 81.9 | 16,814 | $0.040 | no record (two-run mean 92.35 vs 91.85, +0.5; time -7%). Kept in tree unmerged as the base for iteration 6. |
| 6 | iter6-hard-stop | Prompt + banner: finish() prints "FINAL ANSWER (do not run any further cell)"; prompt treats a further cell as an error. | 90.9 | 2 | 87.4 | 16,173 | $0.040 | no record (cells unchanged at 4-17; tokens -4%). Kept (harmless). |
| 7 | iter7-shading-tiebreak | Helper: when the two silhouettes cannot separate sphere from cube, the fraction of flat-gradient pixels inside the blob decides (size-aware thresholds measured on 130 blobs). Offline automatic pipeline: bench 90.9 -> 94.6, held-out 91.5 -> 93.0. Prompt describes verdicts as silhouette + shading. | 95.8 | 4 | 85.2 | 14,680 | $0.038 | candidate (score +3.95, tokens -10%) |
| 7b | iter7-shading-tiebreak-confirm | Confirmation run. | 92.7 | 3 | 92.4 | 16,453 | $0.040 | **record** (two-run mean 94.25 vs 91.85; time -5%, tokens -4%) |
