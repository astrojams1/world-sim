---
name: tune-skill
description: Iterate the room-reconstruction skill (prompt + sandbox helper) against the fixed benchmark without cheating, minimising score loss, time, tokens and cost. Use for "tune the skill", "improve the benchmark", "run the tuning loop", or /tune-skill. Each iteration ends with a verbose report; a new record is re-verified, committed and merged.
---

# tune-skill

One iteration of the skill-tuning loop for World Sim. Run it repeatedly (e.g. with `/loop /tune-skill`) until the
benchmark stops improving or the user stops you.

## Ground rules (never relax these)

- The model receives ONLY: the two unaltered camera images, "the room is a 1x1x1 cube seen from two viewpoints",
  the generator's object rules, and the task/output format. No calibration, no colours, no per-room data.
- Allowed to change: `src/lib/skill.ts` (prompt), `src/lib/sandbox/worldsim.py` (helper tools), model / reasoning
  effort defaults, and the request plumbing as long as it carries nothing new. NOT allowed: touching the scorer to
  make scoring easier, the generator to make rooms easier, or the benchmark seed set.
- Every run must pass `npm run check:no-cheating` (static) and the bench's runtime request check (no violations).
- A room that fails with an API-side error (rate limit, moderation false positive, network) is retried once by the
  bench (`--retry-errors`); a timeout or a bad answer is never retried. Say so in the report when it happens.

## The benchmark

- Fixed seeds `101..110` (see `BENCH_SEEDS` in `scripts/bench.mjs`), model `gpt-5-mini` unless the iteration is
  about the model. `bench/BENCH.md` holds the record and the history.
- Metrics per run: mean score (primary), exact matches, mean seconds, mean tokens, estimated cost per room.
- A **record** is: mean score at least 1.0 point above the current record, OR mean score within 1.0 point of the
  record with cost per room at least 20% lower, OR mean score within 1.0 point of the record with time per room at
  least 30% lower. Ties go to the cheaper, then faster, run. Once the record is above 99.0 a full +1.0 is
  impossible, so a two-run mean of 100.0 (every room exact in both runs) also counts as a record. Note that the
  cost floor is the code-interpreter session (about $0.03 of the $0.032), so cost records are effectively closed;
  time and score are the remaining levers.
- Single runs are noisy (several points). A candidate record must be **confirmed by a second run** of the same
  configuration; the record is the mean of both runs. Do not spend the confirmation run on non-candidates.

## Procedure

1. Read `bench/BENCH.md` (record + history + hypotheses already tried). Read the last results JSON in
   `bench/results/` and look at the per-seed failures (guess vs truth) to pick the biggest recoverable loss.
2. State ONE hypothesis for this iteration and the single change that tests it. Prefer changes that also cut time or
   tokens (fewer code runs, tighter iteration caps, lower reasoning effort) when accuracy is unaffected.
3. Apply the change. Run `node scripts/embed-sandbox.mjs`, `npx eslint .`, `npx tsc --noEmit -p .`,
   `npm run check:no-cheating`. If the helper changed, run the offline simulation
   (`scratchpad`-style test with truth shapes) on a few seeds to catch regressions before spending API money.
4. Start the dev server with `OPENAI_API_KEY` set and run
   `CHROMIUM_PATH=... node scripts/bench.mjs --label <iterN-short-name> --parallel 3` (in the background; it
   takes 10-25 minutes). Never run more than 3 rooms in parallel.
5. When it finishes, compare with the record. Write the verbose report (below). Append a row to the history table
   in `bench/BENCH.md` regardless of outcome, with the hypothesis and the result, so it is never retried.
6. If it is a new record: re-run `npm run check:no-cheating`, re-read the diff for anything that leaks room data,
   confirm the bench reported zero violations, update the record line in `bench/BENCH.md`, commit, push, open a PR
   and merge it. If not a record: revert the change (keep the history row) unless it is a pure cost/time win with
   no score loss, in which case treat it as a record by the rule above. Exception: a helper change that is neutral
   on the benchmark set (within noise) but clearly better on the offline held-out set (seeds 201-210) may be kept
   in the tree as the base for the next iteration; it is merged with the next record. The held-out set is the
   guard against tuning to the benchmark rooms, so never choose changes on the benchmark set alone.

## The report (every iteration, verbose)

- Hypothesis and exact change (files, what/why).
- Anti-cheat: static check result; runtime violations count.
- Per-seed table: seed, score, exact?, seconds, tokens, cost, code runs, and for non-exact rooms what was wrong
  (missing/extra object, wrong shape, position off, orientation off).
- Aggregates vs the record: mean score, exact matches, mean seconds, mean tokens, mean cost/room, wall clock.
- Verdict: record / no record / cost win, and what was committed or reverted.
- Next hypothesis.
