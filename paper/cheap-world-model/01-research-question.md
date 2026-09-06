# Research question

## Candidates

**Q1 (chosen). How far can a training-free system — a cheap hosted vision LLM driving a classical
analysis-by-synthesis pipeline in a code sandbox — go toward recovering the complete metric 3D state of a
scene from two uncalibrated images, and what does it cost?**
Evidence needed: accuracy on a fully-specified state (shape, colour, size, position, orientation) with a
frame-invariant metric; cost and latency per instance; a scaling axis (object count); the contribution of
each part (LLM vs pipeline); a held-out check. Repo has: all except a committed LLM-vs-pipeline ablation and
API held-out results (stage 13/14 address these).

**Q2. Does a cheap LLM's visual judgement (counting, colour, merged-blob splitting) add accuracy on top of a
classical pipeline?** Evidence needed: paired runs with/without the LLM's reconciliation step. Repo has only
indirect evidence ("the model copies the pipeline", identical per-room scores). Important as a sub-question
and as the honest framing of Q1; not sufficient alone because the negative answer is not yet measured with
the API.

**Q3. What benchmark protocol makes prompt+tool co-design of an LLM agent measurable without cheating?**
Evidence: fixed seeds, second-run confirmation, anti-cheat gate, held-out set, record rule with time/cost
objectives, 26-iteration history. Repo has all of it. A benchmark/protocol paper is defensible but the
benchmark is small and synthetic, so it is better as a secondary contribution.

## Chosen question and why

Q1, with Q2 folded in as the key ablation and Q3 as the protocol contribution. Q1 is falsifiable (a score,
a cost, a latency, a capacity), the repo's evidence bears directly on it, and the application framing the
user wants (robotics automation) is exactly a question of cheap state estimation for downstream control.

## What the question is *not*

- Not "is this a world model in the Ha-Schmidhuber / Dreamer sense" (no dynamics, no prediction, no latent
  learned representation). The paper must define the term it uses: a *state estimator* that produces an
  explicit, simulator-ready scene description; the "world model" wording is scoped to that.
- Not a claim about real photographs; the benchmark is synthetic and the claim is about the benchmark.
- Not a claim about the LLM's intrinsic 3D understanding.

## Answer after the experiments (added 2026-09-06)

Stage 14 answered Q2 in the negative: the helper alone reproduces every benchmark answer, the VLM's
contribution went from +13.9 points (iteration 0) to exactly 0 (iteration 15 onward), and where the VLM did
intervene (capacity rooms) it helped once and hurt once. That negative answer changes the subject of Q1: the
system that "goes far" is the deterministic pipeline, and the question the evidence answers is

**Q1′. How far can a deterministic, training-free analysis-by-synthesis pipeline that calibrates its own
cameras go toward recovering the complete metric 3D state of a scene from two uncalibrated images — and does
a cheap vision LLM placed around it add anything?**

Answer: 99.5/100 on the tuned rooms, 95.3 on 100 fresh rooms, in seconds of CPU; and no, not once the tools
were good. The run-1 paper kept Q1's wording with the VLM as subject; the revision writes Q1′.
