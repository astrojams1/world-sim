---
name: tune-skill
description: Iterate the room-reconstruction skill (prompt + sandbox helper) against the fixed benchmark without cheating, minimising score loss, time, tokens and cost. Use for "tune the skill", "improve the benchmark", "run the tuning loop", or /tune-skill. Each iteration ends with a verbose report; a new record is re-verified, committed and merged.
---

# tune-skill

**Make the room-reconstruction skill score higher, faster and cheaper on a fixed benchmark, without cheating.** A
gain only counts if the model saw nothing more than a real user would give it.

Done means: one hypothesis was tested with zero anti-cheat violations. Its row is in `bench/BENCH.md` and the verbose
report is written. A confirmed record is also committed, pushed and merged.

One run is one iteration of the tuning loop for World Sim. Run it again and again (for example with
`/loop /tune-skill`) until the benchmark stops improving or the user stops you.

## Where things are

| What | Where |
|---|---|
| Record, history, hypotheses tried, capacity ladder | `bench/BENCH.md` |
| Per-run results | `bench/results/` |
| Prompt | `src/lib/skill.ts` |
| Helper tools | `src/lib/sandbox/worldsim.py` |
| Bench | `scripts/bench.mjs` (`BENCH_SEEDS`) |
| Static anti-cheat check | `npm run check:no-cheating` |

## A run

1. **Read** `bench/BENCH.md`: the record, the history, the hypotheses already tried and the capacity ladder. Read the
   last results JSON in `bench/results/`. Look at the per-seed failures (guess vs truth) to find the biggest loss you
   can recover. Decide which axis this iteration works on: the default benchmark (score or time), or capacity
   (objects).
2. **Hypothesize.** State ONE hypothesis and the single change that tests it. Prefer changes that also cut time or
   tokens when accuracy is unaffected: fewer code runs, tighter iteration caps, lower reasoning effort.
3. **Apply and check offline.** Make the change. Run `node scripts/embed-sandbox.mjs`, `npx eslint .`,
   `npx tsc --noEmit -p .` and `npm run check:no-cheating`. If the helper changed, run the offline simulation
   (`scratchpad`-style test with truth shapes) on a few seeds. It catches regressions before you spend API money.
4. **Bench.** Start the dev server with `OPENAI_API_KEY` set. Run
   `CHROMIUM_PATH=... node scripts/bench.mjs --label <iterN-short-name> --parallel 3` in the background. It takes
   10-25 minutes. Never run more than 3 rooms in parallel.
5. **Compare and log.** When it finishes, compare with the record. Write the verbose report (see [Report](#report)).
   Append a row to the history table in `bench/BENCH.md` whatever the outcome, with the hypothesis and the result, so
   it is never retried.
6. **Keep or revert.**
   - **A new record:** re-run `npm run check:no-cheating`. Re-read the diff for anything that leaks room data. Confirm
     the bench reported zero violations. Update the record line in `bench/BENCH.md`. Commit, push, open a PR and merge
     it.
   - **Not a record:** revert the change and keep the history row. The exception is a pure cost or time win with no
     score loss: treat that as a record by the rule below.
   - **Held-out exception:** a helper change may stay in the tree if it is neutral on the benchmark set (within noise)
     but clearly better on the offline held-out set (seeds 201-210). It is the base for the next iteration and merges
     with the next record.

## The benchmark

- **Seeds and model.** Fixed seeds `101..110` (see `BENCH_SEEDS` in `scripts/bench.mjs`). Model `gpt-5-mini`, unless
  the iteration is about the model.
- **Metrics per run:** mean score (primary), exact matches, mean seconds, mean tokens, estimated cost per room.
- **A record** is any of these:
  - mean score at least 1.0 point above the current record;
  - mean score within 1.0 point of the record, with cost per room at least 20% lower;
  - mean score within 1.0 point of the record, with time per room at least 30% lower.

  Ties go to the cheaper run, then the faster one. Once the record is above 99.0, a full +1.0 is impossible. So a
  two-run mean of 100.0 (every room exact in both runs) also counts as a record.
- **Cost records are effectively closed.** The cost floor is the code-interpreter session, about $0.03 of the $0.032.
  Time and score are the levers left.
- **Confirm with a second run.** Single runs are noisy, by several points. A candidate record must be confirmed by a
  second run of the same configuration. The record is the mean of both runs. Don't spend the confirmation run on a
  non-candidate.

### The capacity axis (number of objects)

- **Object counts.** Default rooms draw 2-5 objects per seed. Every seed can also be generated with an exact object
  count `N` (2..12): `generateRoom(seed, N)`, the app's "Objects" select, or `node scripts/bench.mjs --objects N`. The
  goal on this axis is to **maximise the number of objects the skill still reconstructs**.
- **Capacity** is the largest `N` for which seeds `101..110` at `--objects N` reach a two-run mean score of at least
  **95.0**, with zero API errors. Measure it on the ladder `6, 8, 10, 12`.
- **A capacity record** is a higher `N` that passes, OR the same `N` with a mean score at least 1.0 higher, confirmed
  by a second run.
- **Report every rung tried:** mean score, time and tokens. The time budget per room at `N` objects is not part of
  the rule, but report it.
- **Never lower the default record.** Every capacity iteration re-runs the offline pipeline on the default rooms
  (bench 101-110 and held-out 201-210). Revert any change that costs more than noise there.
- **The count stays hidden.** The prompt keeps stating the generator rule "between 2 and 12 objects". Never pass the
  actual count to the model.
- **Test offline first.** Rooms with an explicit count are rendered offline the same way as the default ones
  (`scratchpad` rooms named `<seed>-o<N>`). So you can test the automatic pipeline on them before spending API money.

## Rules

**Never relax these.**

- **The model gets ONLY four things.** The two unaltered camera images. "the room is a 1x1x1 cube seen from two
  viewpoints". The generator's object rules. The task and output format. No calibration, no colours, no per-room
  data.
- **What you may change:** `src/lib/skill.ts` (prompt), `src/lib/sandbox/worldsim.py` (helper tools), model and
  reasoning-effort defaults, and the request plumbing as long as it carries nothing new.
- **What you may NOT change:** the scorer to make scoring easier, the generator to make rooms easier, or the benchmark
  seed set.
- **Every run passes both checks:** `npm run check:no-cheating` (static) and the bench's runtime request check (no
  violations).
- **Retry only API-side errors.** An API-side error is a rate limit, a moderation false positive or a network error.
  The bench retries such a room once (`--retry-errors`). Never retry a timeout or a bad answer. Say
  so in the report when a retry happens.
- **Guard against tuning to the benchmark.** The held-out set is that guard. Never choose a change on the benchmark set
  alone.

## Report

Write a verbose report every iteration:

- **Hypothesis and exact change:** files, what and why.
- **Anti-cheat:** static check result and runtime violations count.
- **Per-seed table:** seed, score, exact?, seconds, tokens, cost, code runs. For non-exact rooms, say what was wrong:
  missing or extra object, wrong shape, position off, orientation off.
- **Aggregates vs the record:** mean score, exact matches, mean seconds, mean tokens, mean cost per room, wall clock.
- **Verdict:** record, no record or cost win, and what was committed or reverted.
- **Next hypothesis.**
