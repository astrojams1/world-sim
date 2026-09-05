# Experiments: missing, run, recommended

## What a reviewer would demand, per claim

| Claim | Demanded | Status |
|---|---|---|
| 99.5 / 22 s / $0.032 on the benchmark | protocol, two runs, per-room table, variance | **have** (48 result files; `analysis.json`) |
| accuracy came from tool-ification | trajectory with cells/tokens/time per iteration | **have** (history table + frontier figure) |
| LLM adds nothing | pipeline-alone ablation on the same rooms | **run here** (offline, `experiments/offline-default.json`) |
| no overfitting to the 10 rooms | held-out set | **run here offline** (`offline-heldout` merged into `offline-default.json`); API held-out **recommended** |
| capacity 8 | ladder with/without model | **have** (API 6/8/10) + **run here** (offline 6/8/10/12) |
| low effort ≈ medium | same-code pair | **have** (iter 8 vs 9 + 9d diagnosis) |
| VLM alone cannot do it | VLM-only baseline (no sandbox; sandbox w/o helper) | **recommended** (repo has only the gpt-4.1-mini anecdote) |
| generality across models | other cheap models at the record prompt | **recommended** |
| real images | physical cube room | **out of scope** (stated in limitations) |

## Run here (no API spend)

1. `scripts/render_rooms.mjs` — rendered seeds 101–110 and 201–210 (default draw) and 101–110 at 6/8/10/12
   objects with the app in headless Chromium (WebGL context loss after ~14 renders → page reload every 6
   seeds; black renders detected and re-rendered).
2. `scripts/run_offline.py` — `solve_all(verbose=False)` from `src/lib/sandbox/worldsim.py` on each room
   in a fresh subprocess; `scripts/score_rows.ts` scores with the repo's scorer.
   - Benchmark 101–110: mean **99.48**, 6 exact — identical per room to the record run.
   - Held-out 201–210: mean **99.61**, 7 exact (204: 98.2 pos 0.071 + ori 16°/23°; 205: 99.1 pos 0.071; 210:
     98.8 ori 15° + pos 0.071).
   - Capacity offline: 6 → 97.3 (3 exact), 8 → 95.9 (3), 10 → 90.4 (1, 5 objects missing), 12 → 80.8 (0, 13
     missing). Matches BENCH.md's offline notes (90.4 at 10, 80.7 at 12).
   - Offline seconds (2 vCPU, shared with rendering): 8–21 s benchmark, 3.5–10 s held-out, 8–14 s capacity.
3. `scripts/analyze_bench.py` — history table, frontier figure, record per-room table with error taxonomy,
   variance over 14 candidate/confirm pairs (139 room pairs: 84 % identical, median |Δ| 0, p90 7, max 27;
   record pair identical on all rooms), effort ablation numbers, token anatomy, totals (48 files, 454 rooms,
   $16.07, 5.13 M tokens, 01:47–12:31 UTC).

## Recommended runs (require OPENAI_API_KEY; ≈ $0.32 per 10-room run)

```bash
npm run dev   # with OPENAI_API_KEY in .env.local
# (i) API on the held-out set — the one number the paper still owes
CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/bench.mjs --label heldout-api --seeds 201,202,203,204,205,206,207,208,209,210 --effort low --parallel 3
# (ii) VLM-only baselines: needs two small prompt variants (no sandbox tool; sandbox without worldsim.py) —
#      add a --variant flag to route.ts/skill.ts; expected: far below 90, establishes the floor
# (iii) capacity with an explicit "split wide blobs" instruction at 10 objects
node scripts/bench.mjs --label capacity-10-split --objects 10 --effort low
# (iv) other models at the record prompt
node scripts/bench.mjs --label nano --model gpt-5-nano --effort low
node scripts/bench.mjs --label 4o-mini --model gpt-4o-mini
```

Expected effect on the paper: (i) turns "held-out offline" into "held-out with the model"; (ii) supplies the
VLM-only row that Section 5 currently argues in prose; (iii) tests the one place the model could add
accuracy; (iv) separates harness from model.
