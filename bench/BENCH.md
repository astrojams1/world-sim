# Benchmark

Fixed set: seeds 101-110 (`BENCH_SEEDS` in `scripts/bench.mjs`), `BENCH_SET_VERSION = 1`.
Model `gpt-5-mini` unless stated. Costs are estimates from list prices plus one code-interpreter session per room.

Record rule: mean score >= record + 1.0, or within 1.0 of the record with cost/room >= 20% lower.

## Record

**iter0-baseline** — mean 90.0, 2/10 exact, 231.7 s/room, 23,132 tokens/room, $0.045/room (wall clock 16.1 min with 3 workers). Commit: harness commit on 2026-09-05.

## History

| Iter | Label | Hypothesis / change | Mean | Exact | Mean s | Mean tokens | Cost/room | Verdict |
|---|---|---|---|---|---|---|---|---|
| 0 | iter0-baseline | Baseline: current prompt + helper, gpt-5-mini medium | 90.0 | 2 | 231.7 | 23,132 | $0.045 | record (baseline) |
