# Candidate contributions

| # | Contribution | Evidence | Strength | Reviewer objection |
|---|---|---|---|---|
| C1 | A training-free two-view scene state estimator (explicit shape/colour/size/pose for every object) that runs inside one LLM response: cheap VLM + self-calibrating classical pipeline in a code sandbox, no calibration or side information | `src/lib/skill.ts`, `worldsim.py`, `route.ts`; record runs | strong (as a system on this benchmark) | synthetic, tiny vocabulary; "training-free" is really "no training of *ours*" — the VLM was trained |
| C2 | Headline numbers: 99.5/100 mean, 6/10 exact, 22.3 s, $0.032, 6,274 tokens per scene; 95.9 at 8 objects/scene | `iter23-*.json`, `capacity-8-*.json`, BENCH.md | strong | tuned on those 10 rooms (mitigated by held-out offline set, which we must report) |
| C3 | Self-calibration from the room's own silhouette: 6-corner outline → all corner labellings → pose+focal fit, <1.5 px on 40 cameras; symmetry-resolving `align` over the 48 room frames | `worldsim.py` l.248–820; BENCH.md iter14/15 | medium-strong | standard PnP with unknown focal (known technique); contribution is the robust labelling/fallbacks |
| C4 | Frame- and symmetry-invariant scoring for scene descriptions (48 room symmetries × 24 cube symmetries, assignment matching, extras penalised) | `src/lib/score.ts` | medium | small benchmark; but the metric design is reusable |
| C5 | Empirical: the cost/accuracy frontier moved from 90.0 @ 232 s / 23k tokens to 99.5 @ 22 s / 6.3k tokens by moving computation from model turns into deterministic tools (cells per room 21.7 → 1.0) — "tool-ification" of the loop | 48 result files; history table | strong (unique dataset of 26 iterations, $16) | it is one model, one task |
| C6 | Empirical: low reasoning effort matches medium once the tool printout is robust (iter8 vs 9–15), and the failure mode of low effort is giving up on truncated output, not wrong reasoning | iter9-diag, iter10–12 rows | medium | n=10 rooms |
| C7 | Failure taxonomy at the record: silhouette-ambiguous cube orientations (105, 104), coupled position+rotation local minima for occluded objects (108), blobs merged in both views at high object counts (capacity-10: 102/103/104) | BENCH.md iter18b/24/26, capacity rows, transcripts | medium-strong | qualitative; counts small |
| C8 | Protocol for prompt+tool co-design without cheating: fixed seeds, second-run confirmation, record rule with time/cost objectives, static + runtime anti-leak checks, offline held-out guard | `tune-skill/SKILL.md`, `check-no-cheating.mjs`, `bench.mjs` | medium | not novel individually |
| C9 | Ablation: the LLM's contribution over the offline pipeline (to be produced in stage 14 offline; API version recommended) | *pending* | pending | the central honesty question |
| C10 | Cost anatomy: $0.030 of $0.032 is the sandbox session; the model itself is ≈$0.002; latency floor ≈14 s of fixed API overhead | bench PRICES, iter23 notes | medium | pricing dates quickly |
| C11 | Negative results: residual-region explanation at capacity (iter26) raised held-out phantoms; second rotation refinement (iter24) worsened 105 | BENCH.md | weak-medium | anecdotal |

## Pruned set for the paper (revised 2026-09-06, after the thesis re-check)

1. **The deterministic pipeline + numbers** (C1 + C3 + C2 helper-alone rows + fresh test set): explicit,
   simulator-ready scene state from two uncalibrated images with no training and no model, 99.5 on the tuned
   rooms, 95.3 [93.4, 96.9] on 100 fresh rooms, ≈10 s of CPU.
2. **The VLM's contribution, measured over the campaign** (C9 + C5 + C6): +13.9 → 0 as work moved from the
   model into the tools; of both signs where it intervened; the hosted-call deployment costs $0.032 and 22 s.
3. **Benchmark, metric and anti-cheat protocol** (C4 + C8): unchanged.
4. **Failure analysis** (C7 + C11): unchanged.

Run-1 order (superseded): "System + numbers" with the VLM + helper system as item 1 and the helper-alone
ablation folded into item 2. The evidence for C9 (produced in stage 14) is what moved the helper to item 1.

## Pruned set for the paper (run 1 — superseded)

1. **System + numbers** (C1 + C2 + C10): explicit, simulator-ready scene state from two uncalibrated images,
   no training, ≈3 cents and ≈22 s per scene.
2. **Where the accuracy comes from** (C5 + C6 + C9): the tuning trajectory shows accuracy and cost improving
   together as work moves from LLM turns to deterministic tools; the LLM's marginal contribution is measured.
3. **Benchmark, metric and anti-cheat protocol** (C4 + C8): symmetry-invariant scoring and a confirmed-record
   protocol for agent tuning; the capacity axis.
4. **Failure analysis** (C7 + C11): what two views cannot resolve, and where the approach breaks as scenes
   get crowded.

C3 is described in the method but not claimed as novel.
