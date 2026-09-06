---
name: tune-skill
description: Iterate the room-reconstruction skill (prompt + sandbox helper) against the fixed benchmarks without cheating, in either mode (static room or moving platform) or on the capacity axis, minimising score loss, time, tokens and cost. Use for "tune the skill", "improve the benchmark", "run the tuning loop", "tune mode 2", or /tune-skill. Each iteration ends with a verbose report; a new record is re-verified, committed and merged.
---

# tune-skill

One iteration of the skill-tuning loop for World Sim. Run it repeatedly (e.g. with `/loop /tune-skill`) until the
benchmarks stop improving or the user stops you. Every iteration works on exactly ONE axis:

| Axis | What is optimised | Bench command |
|---|---|---|
| **mode 1** (static room) | mean score, then time / tokens / cost, seeds 101-110 | `node scripts/bench.mjs --label <label>` |
| **capacity** (mode 1, N objects) | the largest N that still scores >= 95 | `node scripts/bench.mjs --label <label> --objects N` |
| **mode 2** (moving platform) | mean score, then time / tokens / cost, seeds 101-110 in platform mode | `node scripts/bench.mjs --label <label> --mode platform` |

## Ground rules (never relax these)

- The model receives ONLY: the unaltered camera images (two in mode 1, four in mode 2), the fixed rules of the
  mode ("the room is a 1x1x1 cube seen from two viewpoints", the generator's object rules and, in mode 2, the
  platform's fixed constants: tilt range, `PLATFORM_OFFSET`, speed range, `SNAPSHOT_INTERVAL`, in-plane motion,
  objects rest on the top side), and the task/output format. No calibration, no colours, no object count, no
  per-room data of any kind. The mode itself is the only other thing the client tells the server, and it selects
  a fixed prompt.
- Allowed to change: `src/lib/skill.ts` (prompts), `src/lib/sandbox/worldsim.py` (helper tools), model / reasoning
  effort defaults, and the request plumbing as long as it carries nothing new. NOT allowed: touching the scorer to
  make scoring easier, the generator to make rooms easier, or the benchmark seed set.
- Every run must pass `npm run check:no-cheating` (static) and the bench's runtime request check (no violations:
  the bench intercepts every request and checks that the body is exactly `{model, reasoningEffort, mode, images}`
  with the images shown on the page).
- **Mode 1 stays bit-identical unless the iteration is about mode 1.** The helper is shared by both modes, so any
  helper change made for mode 2 or capacity must leave the static pipeline's answers unchanged on the paper's
  rendered rooms (the offline identity check below). A mode-1 change goes through the mode-1 record rule.
- A room that fails with an API-side error (rate limit, moderation false positive, network) is retried once by the
  bench (`--retry-errors`); a timeout or a bad answer is never retried. Say so in the report when it happens.

## The benchmarks

- Fixed seeds `101..110` (`BENCH_SEEDS` in `scripts/bench.mjs`) in both modes; the held-out set is `201..210` and
  is used **offline only** (never for the record rule): it is the guard against tuning to the benchmark rooms.
  Model `gpt-5-mini`, reasoning effort `low`, unless the iteration is about the model. `bench/BENCH.md` holds the
  records and the history (one table per axis).
- Metrics per run: mean score (primary), exact matches, mean seconds, mean tokens, estimated cost per room.
- A **record** (mode 1 and mode 2 alike) is: mean score at least 1.0 point above the current record, OR mean score
  within 1.0 point of the record with cost per room at least 20% lower, OR mean score within 1.0 point of the
  record with time per room at least 30% lower. Ties go to the cheaper, then faster, run. Once the record is above
  99.0 a full +1.0 is impossible, so a two-run mean of 100.0 (every room exact in both runs) also counts as a
  record. The cost floor is the code-interpreter session (about $0.03 of the $0.032), so cost records are
  effectively closed; time and score are the remaining levers.
- Single runs are noisy (several points). A candidate record must be **confirmed by a second run** of the same
  configuration; the record is the mean of both runs. Do not spend the confirmation run on non-candidates. A run
  whose rooms all took one code cell is deterministic up to API errors; a confirmation is then a formality, but
  it is still required.
- **Mode 2 has no API record yet**: the first `--mode platform` bench run (two runs, mean) sets it. Its offline
  floor (helper alone) is 100.0 on both seed sets, so the first thing to learn from that run is what the model
  adds or breaks on top of the helper (extra cells, changed counts, edited numbers); the prompt is the lever.

### The capacity dimension (number of objects)

- Besides the default rooms (2-5 objects drawn per seed), every seed can be generated with an exact object count
  `N` (2..12, `generateRoom(seed, N)`; the app's "Objects" select; `node scripts/bench.mjs --objects N`). The
  goal on this axis is to **maximise the number of objects the skill still reconstructs**.
- **Capacity** is the largest `N` for which the seeds `101..110` at `--objects N` reach a two-run mean score of at
  least **95.0** with zero API errors. Measure it on the ladder `6, 8, 10, 12`: a capacity record is a higher `N`
  that passes, OR the same `N` with a mean score at least 1.0 higher (confirmed by a second run). Report the mean
  score, time and tokens at every rung tried; the time budget per room at `N` objects is not part of the rule but
  is reported.
- Capacity work must never lower the mode-1 record: every capacity iteration re-runs the offline pipeline on the
  default rooms (bench 101-110 and held-out 201-210) and any change that costs more than noise there is reverted.
  The prompt keeps stating the generator rule "between 2 and 12 objects"; the actual count is never passed.
- Rooms with an explicit count are rendered offline like the default ones (`--objects N`, rooms named
  `<seed>-o<N>`), so the automatic pipeline can be tested on them before spending API money.

### Mode 2 (moving platform)

- The objects rest on an infinite, featureless, pure-green plane (tilt <= 40 degrees, passing within 0.25 of the
  room centre) that moves at 0.1-0.3 units/s in some direction within itself; each camera takes two snapshots
  0.5 s apart, so the model gets four images (A, B, A2, B2) and must return the plane's position (its point nearest
  the room centre), normal and velocity plus every object at the first snapshot. The plane looks the same in both
  snapshots: the velocity is observable only through the objects' motion. The platform is 30% of the score (plane
  offset, normal, velocity), the objects 70% (scored as in mode 1). See README "Mode 2".
- Entry point in the helper: `ws.solve_platform()` (and `ws.finish_platform()`); the object tools are the mode-1
  ones running under a "resting on the platform" constraint (`_platform_snap`, `_search_axes`,
  `_rotation_candidates`, `_platform_ray_candidates`); the plane fit is `fit_platform`, the motion search
  `platform_displacement`. Per-room diagnostics to read in a failed room: the frame chosen by `align` (a wrong
  frame shows as a large triangulation residual and a plane IoU below ~0.9), the plane's silhouette IoU, the
  shape-check lines (a 0.1 cube lying flat vs a 0.15 sphere is the usual confusion), and the second-snapshot object
  fit (below ~0.6 means the displacement search settled on a wrong blob match).
- Mode-2 prompt levers: the inventory step (the model's eyes decide count and colours, as in mode 1), the
  one-cell discipline, and the reconcile rules. Never let the prompt hint at the plane's pose or the velocity.

## Offline tools (no API key needed; run them before spending API money)

```bash
npm run dev                                                  # in the background, no API key needed for rendering
CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
  node scripts/render-rooms.mjs --seeds 101-110,201-210 --mode platform --out bench/rooms     # mode-2 rooms
CHROMIUM_PATH=... node scripts/render-rooms.mjs --seeds 101-110 --objects 8 --out bench/rooms  # capacity rooms
python3 scripts/run-offline.py --rooms bench/rooms --filter ".*-p" --out /tmp/plane.json --parallel 2
npx tsx scripts/score-rows.ts /tmp/plane.json                # per-room table + mean; platform errors per room
```

- **Offline floor**: the answer the helper alone gives (what one cell returns). The API run can only add to it
  through the model's inventory reconciliation; a helper change is judged first on the offline floor of bench and
  held-out rooms in the axis's mode, then (if it holds) on an API run.
- **Mode-1 identity check** (mandatory after any helper change made for mode 2 or capacity):
  ```bash
  git show main:src/lib/sandbox/worldsim.py > /tmp/worldsim_main.py
  python3 scripts/run-offline.py --rooms paper/cheap-world-model/experiments/rooms --filter "(10[1-9]|110)" --out /tmp/static_main.json --helper /tmp/worldsim_main.py
  python3 scripts/run-offline.py --rooms paper/cheap-world-model/experiments/rooms --filter "(10[1-9]|110)" --out /tmp/static_tree.json
  python3 scripts/compare-offline.py /tmp/static_main.json /tmp/static_tree.json    # must print "identical"
  ```
  (The paper's rooms are the mode-1 benchmark rooms rendered once; `_offline/` work directories are created next
  to them and are ignored by git.)
- The static prompt must not change in a mode-2 or capacity iteration either: `buildSystemPrompt("static")` is
  the record's prompt verbatim (only the bootstrap's file list may differ).

## Procedure

1. Read `bench/BENCH.md` (records, histories, hypotheses already tried, the capacity ladder, the mode-2 section).
   Read the last results JSON of the axis in `bench/results/` and look at the per-seed failures (guess vs truth,
   and for mode 2 the platform errors) to pick the biggest recoverable loss. Decide which axis this iteration
   works on: mode 1 (score/time), capacity (objects), or mode 2 (platform). Rotate axes when one is stuck: a
   change that is neutral on its own axis is never worth an API run.
2. State ONE hypothesis for this iteration and the single change that tests it. Prefer changes that also cut time or
   tokens (fewer code runs, tighter iteration caps, lower reasoning effort) when accuracy is unaffected.
3. Apply the change. Run `node scripts/embed-sandbox.mjs`, `npx eslint src scripts`, `npx tsc --noEmit -p .`,
   `npm run check:no-cheating`. If the helper changed, run the offline floor on the axis's rooms (bench and
   held-out) and, unless the axis is mode 1, the mode-1 identity check; revert anything that loses more than noise
   on the held-out rooms or breaks identity.
4. Start the dev server and run
   `CHROMIUM_PATH=... node scripts/bench.mjs --label <axis-iterN-short-name> [--mode platform | --objects N] --parallel 3`
   (in the background; it takes 10-25 minutes). Never run more than 3 rooms in parallel. Mode-2 labels start with
   `platform-`, capacity labels with `capacity-N-`. The API key lives on Vercel (production), not in this
   environment: when there is no local `OPENAI_API_KEY`, merge the iteration's helper/prompt into `main` first
   (production must run the code under test, or the bench measures the wrong helper), then add
   `--api https://world-sim-delta.vercel.app` (with `NODE_USE_ENV_PROXY=1` behind the sandbox proxy): the page
   renders locally and only the `/api/analyze` requests are answered by production; the runtime request check is
   unchanged. Previews have no key. Wait for the production deployment of the merge commit to be READY (Vercel
   `get_deployment` on `world-sim-delta.vercel.app`) before starting the run.
5. When it finishes, compare with the axis's record. Write the verbose report (below). Append a row to the axis's
   history table in `bench/BENCH.md` regardless of outcome, with the hypothesis and the result, so it is never
   retried.
6. If it is a new record: re-run `npm run check:no-cheating`, re-read the diff for anything that leaks room data,
   confirm the bench reported zero violations, run the confirmation, update the record line in `bench/BENCH.md`,
   commit, push, open a PR and merge it. If not a record: revert the change (keep the history row) unless it is a
   pure cost/time win with no score loss, in which case treat it as a record by the rule above. Exception: a helper
   change that is neutral on the benchmark set (within noise) but clearly better on the offline held-out set may
   be kept in the tree as the base for the next iteration; it is merged with the next record. Never choose changes
   on the benchmark set alone.

## The report (every iteration, verbose)

- Axis, hypothesis and exact change (files, what/why).
- Anti-cheat: static check result; runtime violations count; mode-1 identity check result (when required).
- Per-seed table: seed, score, exact?, seconds, tokens, cost, code runs, and for non-exact rooms what was wrong
  (missing/extra object, wrong shape, position off, orientation off; in mode 2 also plane offset / normal /
  velocity errors and whether a wrong frame or a wrong blob match caused them).
- Aggregates vs the axis's record: mean score, exact matches, mean seconds, mean tokens, mean cost/room, wall
  clock; for mode 2 also the offline floor of the same rooms, so the model's contribution is visible.
- Verdict: record / no record / cost win, and what was committed or reverted.
- Next hypothesis (and axis).
