# Understanding: world-sim

## One paragraph: what it is

World Sim asks whether a cheap hosted vision LLM (`gpt-5-mini`, reasoning effort *low*) can recover the full
3D state of a synthetic room — the shape, colour, size, position and orientation of every object — from two
uncalibrated photographs, with no training, no camera calibration, and no per-room side information. The
model gets only the two images, the fact that the room is a unit cube, the generator's object vocabulary, and
a Python sandbox pre-loaded with a self-calibrating helper module (`worldsim.py`). Inside one API response the
model runs a calibrate → detect → triangulate → hypothesise → render → compare → refine loop, then returns
JSON. A frame-invariant scorer compares the answer with ground truth. After 26 tuning iterations the record
configuration scores 99.5/100 on a fixed 10-room benchmark at 22 s and $0.032 per room (6,274 tokens), with
6/10 rooms exact, and 95.9 with 8 objects per room.

## System / method (as implemented)

**Generator** (`src/lib/room.ts`): seeded RNG; room [0,1]^3; 2–5 objects by default (or an exact count 2–12);
each object sphere|cube, red|blue, size ∈ {0.10, 0.15, 0.20}, centre on a 0.05 grid, ≥0.05 from walls, no
overlaps (margin 0.06); cubes uniformly random Euler XYZ; muted random surface colours (hues kept away from
red/blue); one shadow-casting distant light + ambient + fill; two cameras on a sphere of radius 1.7–2.6,
elevation 25–60°, azimuth separation 50–310°, FOV ≈ 2·atan(1/r)+2..10°, looking near the centre. Feeds are
640×480 JPEG rendered with three.js (`src/lib/scene.ts`, `feeds.ts`); near faces culled so the room is an open
box on black.

**Inputs to the model** (`src/lib/skill.ts`, `src/app/api/analyze/route.ts`): system prompt (≈120 lines: the
rules above, the sandbox API, a 5-step method), the two JPEGs as image inputs *and* as sandbox files, and
`worldsim.py`. OpenAI Responses API, `background: true`, `tools: [code_interpreter]`, structured output
schema (`notes` first, then `objects`). Nothing about cameras, surface colours or object count. A static
anti-cheat script (`scripts/check-no-cheating.mjs`) forbids the route from touching room/camera data, and
the bench intercepts every request and verifies the body contains only `{model, reasoningEffort, images}`
with the exact page data URLs.

**Helper module** (`src/lib/sandbox/worldsim.py`, 1,968 lines, NumPy + PIL only):
- `room_outline` (l.248): silhouette of the non-black region → convex hull → 6-vertex polygon; candidate
  outlines (merged/coarser/5-corner) as fallbacks (l.603).
- `solve_camera` (l.667): for every labelling of the 6 outline pixels with cube corners (l.565), DLT init +
  batched random-start least squares over (rotation, translation, focal length) (l.394–534); accept first
  labelling under 1 px reprojection; labellings differ by room symmetries.
- `align` (l.761): score the 48 room symmetries for camera B against A by face-colour agreement of
  co-visible faces and by triangulation residual of same-colour blobs; tie-break by image fit.
- `blobs` (l.917): red/blue masks (dominant channel ≥ others + 45), connected components ≥150 px, with area,
  bbox, centroid, circularity.
- `auto_match` (l.891) / `_match_cost` (l.838): assignment of blobs across views by ray gap + apparent-size
  consistency (weight 0.15), unpaired penalty 0.15, capped at the 6 largest blobs per colour.
- `initial_hypothesis` (l.993): one object per pair: triangulated centre, size from apparent width, shape from
  circularity (>0.95 → sphere) unless supplied.
- `explain_unpaired` (l.1743): a blob seen in one view only → search depth × rotation along its ray with a
  depth buffer so occluded parts are neutral; accept if score ≥0.35; printed AUTO-ADDED.
- `shape_check` (l.1156): per object, fit as sphere and as rotation-fitted cube against the matched blob in
  each view (soft sub-pixel renders, l.1320); cube must win by a size-scaled margin (0.06 × scale); if
  inconclusive, `_shading_vote` (fraction of flat-gradient pixels, thresholds per size, l.1124) decides; a
  blob shared in one view is judged from the other view; shared in both → shape left alone.
- `local_search` (l.1594): coordinate descent over position (grid), size, cube rotation, maximising per-object
  soft IoU vs. the residual of the other objects; `refine_rotation` (l.1638) 150 random starts per legal size.
- `compare` (l.1412): render both views, report mean IoU, per-object pixel offsets, phantoms (footprint on
  real pixels of its colour) and unexplained real blobs.
- `solve_all` (l.1864): the whole pipeline in one call; `finish` (l.1914) re-verifies and prints the answer
  under a FINAL/one-open-issue banner; an issue identical to the previous call is accepted as unresolvable.

**Division of labour (as the prompt states it):** the model's eyes decide object count and colours, may add
objects merged into a shared blob via `object_from_pixels`, may remove phantoms; shape verdicts are final;
the model must never type numbers. In practice the record runs use one code cell per room and the
benchmark notes "identical per-room scores, the model copies the pipeline" (BENCH.md capacity-8-confirm).

**Scorer** (`src/lib/score.ts`): exhaustive assignment of guessed to true objects, best over the 48 room
symmetries; per object: shape 20, colour 20, size 20, position 40 (sphere) / position 30 + orientation 10
(cube); position within 0.03 and size within 0.012 get full credit, decaying linearly to 0 at 0.35 / (size
scale); orientation angle minimised over the cube's 24 rotational symmetries, full credit ≤10°, zero at 45°;
each extra object costs as much as a missing one; 100 iff every object exact with no extras.

## Inputs the method receives, and what it is explicitly denied

Receives: two 640×480 JPEGs (unaltered); "room is a 1×1×1 cube, two unknown viewpoints outside"; object
vocabulary (2–12 objects, sphere/cube, red/blue, sizes, 0.05 grid, floating, cubes any orientation); output
schema; the helper module and a 5-step method. Denied: camera intrinsics/extrinsics, surface colours, object
count, seed, any per-room data. Enforced by static check + runtime request interception.

## Evaluation: data, metric, protocol, noise handling

- Fixed benchmark: seeds 101–110 (`BENCH_SEEDS`), default draw 2–5 objects (36 objects total: see
  `experiments/` in stage 14). Held-out set: seeds 201–210 used *offline only* (the automatic pipeline, no
  API), never for the record rule — this is the guard against tuning to the benchmark rooms.
- Capacity axis: same seeds with exact object counts 6, 8, 10, 12; pass = two-run mean ≥95.
- Metrics per run: mean score, exact rooms, mean seconds (wall-clock per room, 3 rooms in parallel), mean
  tokens (input+output+reasoning), estimated cost (list prices + $0.03 per code-interpreter session).
- Record rule: +1.0 mean score, or within 1.0 with cost −20% or time −30%; candidates confirmed by a second
  run; record = mean of both. Noise statement: "the same room can score 56 or 91 on different runs".
- Retry policy: API-side errors (moderation false positives on an unchanged prompt happened twice) retried
  once; timeouts/bad answers never.

## Results inventory

| Result | Value | File | How produced |
|---|---|---|---|
| Baseline (medium effort, before tuning) | 90.0 mean, 2 exact, 232 s, 23,132 tok, $0.045 | `bench/results/iter0-baseline.json` | bench run |
| Record (iter23 two-run mean) | 99.5, 6 exact, 22.3 s, 6,274 tok, $0.032 | `iter23-low-effort-compact-printout{,-confirm}.json` | two bench runs |
| Full history, 26 iterations | table in `bench/BENCH.md` | 48 result files, 454 room solves, $16.07 total, 5.13 M tokens | bench runs 2026-09-05 01:47–12:31 UTC |
| Effort ablation (medium vs low, same code) | iter8 94.3/97 s/15.4k vs iter9 76.6/48 s/10.8k (two empty answers) → after fixes 96.4+ | `iter8-*.json`, `iter9-*.json`, `iter10..15` | bench runs |
| Capacity ladder | 6: 97.7; 8: 95.9 (record); 10: 89.5 | `capacity-*.json` | bench runs |
| Offline automatic pipeline (no LLM) | bench 99.5, held-out 99.6 (BENCH.md iter25) | *no file in repo* — `scratchpad` not committed | **unbacked**; reproduce in stage 14 |
| Cells per room | 21.7 (iter0) → 1.0 (iter21+) | result files, `codeRuns` | bench runs |
| Output tokens per room at record | 320–533 | iter23-confirm rows | bench run |
| Remaining error modes at record | 101 position 0.07 off; 104 orientation 10.9°; 105 orientation 41°; 108 hidden cube 1 grid step + 22° | BENCH.md iter18b/24 + rows | transcripts / offline diagnosis |
| Moderation false positives | 2 of ~450 requests | BENCH.md iter4b, 16b | bench logs |

## Timeline and provenance

- 2026-09-04: app built (generator, renderer, scorer, first prompt), sandbox loop, transcript UI, illegal
  inputs removed, orientation scoring.
- 2026-09-05: tuning harness + `tune-skill` skill; 26 iterations in ≈11 h, each a one-hypothesis change to
  prompt or helper, run by an agent following `.claude/skills/tune-skill/SKILL.md`; records confirmed by a
  second run; anti-cheat gate re-run on each record; capacity axis added.
- The repository, the helper module and the tuning were produced with AI coding agents (commit messages and
  the skill file make this clear). The paper must disclose this.

## Open questions the repo leaves

1. How much does the LLM contribute over the offline pipeline? (BENCH.md says the model "copies the
   pipeline" and offline scores match — but no committed offline results.)
2. Held-out (201–210) results with the API were never run — only offline.
3. Does the approach transfer to real images / other object vocabularies? (Not attempted; synthetic only.)
4. Cost floor: $0.03 of $0.032 is the sandbox session, so "cheapest" is bounded by the sandbox, not the model.
5. Variance: the record shows identical per-room scores across runs (deterministic once one cell), but
   earlier iterations show large spread; no formal variance study.
