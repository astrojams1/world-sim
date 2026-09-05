# Decisions (stages 6–12)

## Thesis (stage 6)

**A cheap vision LLM that only orchestrates a deterministic, self-calibrating analysis-by-synthesis
pipeline inside a code sandbox recovers the complete explicit state of a synthetic multi-object scene
(shape, colour, size, position, orientation) from two uncalibrated images at 99.5/100 on our benchmark, in
22 s and for about 3 cents per scene, with no training of any component — and the accuracy came from moving
work out of the model and into the tools, not from the model's reasoning.**

Rejected broader versions:
- "The world's cheapest world model" — not defensible: "world model" contested (see 03/04), "cheapest" not
  established against anything (cost floor is the sandbox session, and cheaper pipelines without an LLM
  exist trivially). Kept as the *motivation* wording in the introduction: "how cheap can an explicit
  world-model state get without training?"
- "Cheap VLMs can do metric 3D reconstruction" — false as stated; the VLM does not do the reconstruction.

## Paper type (stage 7)

Primary: **systems + empirical study**. Secondary: benchmark/protocol. Reason: the contribution is an
integration and the measured trajectory of how it got good, not a new algorithm; the benchmark, metric and
anti-cheat protocol are reusable but too small to headline.

## Audience (stage 8)

**Robotics perception / embodied AI researchers who use foundation models** (RSS/CoRL/ICRA reviewers) with
LLM-agent researchers as the second reader. Consequences: define the state representation and the metric
formally; they expect baselines in the real-to-sim line (ACDC, URDFormer, Real2Code) and the "VLM alone"
baseline; they will accept synthetic data if limits are explicit; they care about latency and cost per
scene; they will not need code-agent basics explained but will need the geometry stated.

## Venue (stage 9)

arXiv preprint. Primary **cs.RO**, cross-list **cs.CV** and **cs.AI**. No page limit; style: single-column
article. If later submitted, natural targets are a CoRL/RSS workshop on foundation models for robotics or
sim-to-real; keep the main text ≤ 10 pages so it can be cut to a workshop format.

## Scope and length (stage 10)

In scope: the system; the benchmark and metric; the protocol; the record results; the tuning trajectory as
an empirical study (cost/accuracy frontier, effort ablation, cells per room); the capacity ladder; the
LLM-vs-pipeline decomposition (offline here, API run recommended); failure taxonomy; cost anatomy;
limitations; recommended experiments.
Out of scope (stated in the paper): real photographs; open-vocabulary objects; dynamics/prediction;
comparisons run by us against trained baselines (IG-LLM etc. are discussed, not re-run); other LLM
providers. Sentence: "We claim nothing beyond the benchmark described in Section 3."
Target: 9–11 pages main text + appendix (prompt, helper API, full tables).

## Mathematical treatment (stage 11)

Level (b): formal problem statement (scene state space S, observation = two images, unknown camera
parameters), the scoring function with its symmetry group G = O_h (48 elements) and the cube rotation group
(24), the assignment, the tolerance/decay rules; the camera fit as a least-squares over (R, t, f) with the
corner-labelling enumeration; the per-object soft-IoU objective. No derivations beyond one displayed
equation per object; complexity of the labelling enumeration stated. Notation table in the appendix.

## Writing style (stage 12)

First person plural; present tense for the system, past for runs; one claim per paragraph, first sentence
carries it; numbers always with protocol (mean over 10 rooms × 2 runs, etc.) and with what cost includes;
no "novel"/"first" except where 04-novelty.md licenses it; figures: vector PDF, colour-blind safe, one
message each; tables: protocol in caption. British spelling as in the repo ("colour") — no: arXiv
robotics audience is international; use **American spelling** ("color") consistently in the paper while
quoting code identifiers verbatim. Length discipline: introduction ≤ 1.2 pages.
