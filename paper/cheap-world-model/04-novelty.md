# Novelty and closest prior work

## Closest prior work

| Work | Same as ours | Different from ours | Threat to our claim |
|---|---|---|---|
| SpatialClaw (cho2026spatialclaw, Jun 2026) | training-free VLM + persistent Python kernel preloaded with perception/geometry primitives, visual feedback, revise loop | outputs QA answers, not a scored metric scene state; learned primitives (DA3/SAM3); no render-and-compare; no cost; 26–31B open backbones on GPUs | kills any claim to the *agent architecture*; we describe our loop as an instance of this pattern |
| SpatialBabel (liu20263d, May 2026) | primitive scenes (cubes/spheres) → explicit scene code with position/scale, Hungarian-matched fidelity metric | open-loop (code never executed), single view, no calibration, orientation not scored, positions "approximate" | kills "scene-as-code is new"; leaves "closing the loop to near-exact state from two uncalibrated views" |
| VADAR (marsili2025visual, Feb 2025) | LLM + Python + vision modules on CLEVR-like scenes; oracle analysis showing the vision modules, not the LLM, bound accuracy | single image, monocular depth, QA output, ~42 s/query, no $ | precedent for our LLM-vs-pipeline decomposition; cite as such |
| S-Agent / pySpatial / Think3D (2026) | multi-view, training-free VLM agents with tool-built 3D state | learned reconstructors, QA metrics, state never scored, no cost | kills "first VLM agent to build a scene state" |
| IG-LLM (kulits2024re, Apr 2024) | CLEVR image → explicit per-object state incl. location and orientation; Hungarian-matched L2 + attribute accuracy | trained (4k+ images), single view, no calibration problem, no cost | reviewer's "why not just fine-tune?"; our answer: zero training, two-view metric geometry, orientation to 10°, 3 cents |
| ACDC / Digital Cousins (dai2024automated, Oct 2024) | training-free, VLM-orchestrated image → simulator scene for robotics; reports seconds per object | single calibrated RGB + monocular depth, asset retrieval instead of shape/size/rotation estimation; 4–16 cm centre error; no $ | the robotics real-to-sim precedent; we are the narrow, exact-state, uncalibrated, priced counterpart |
| 3DP3 / Bayes3D (gothoskar20213dp3, gothoskar2023bayes3d) | render-and-compare inverse graphics, cube's 24 symmetries, no neural training (Bayes3D) | depth input, known camera, probabilistic-programming runtime | our render-and-compare is the deterministic, RGB-only, uncalibrated cousin; we do not claim inverse graphics is new |
| Neural Scene De-rendering (wu2017neural) | per-object explicit state with position and yaw/pitch/roll, renderer in the loop | trained, single view, symmetry-blind error metric | representation precedent; cite as the origin of "explicit, renderer-consumable state" |
| Agentic Real2Sim (chen2026agentic, Jul 2026) | VLM confined to schema-bounded decisions, deterministic geometry tools do the work; per-episode model bills | calibrated multi-camera + depth + robot trajectory; episode replay | cost-reporting convention to mirror; confirms the "LLM as orchestrator, tools as workers" trend we quantify |

## Novelty statement

To our knowledge no prior work reports a training-free system that recovers the complete explicit state of
a multi-object scene — shape, colour, size, position and orientation for every object — from two
*uncalibrated* RGB views, self-calibrating the cameras from the scene itself, with a symmetry-invariant
accuracy metric and a stated per-scene dollar cost. The individual ingredients (VLM + code kernel,
scene-as-code, analysis by synthesis, symmetry-aware pose metrics) all exist; the contribution is their
closed-loop combination, its measured accuracy/cost/latency frontier, the 26-iteration record of how that
frontier was reached by moving work from model turns into deterministic tools, and a measurement of how
little the LLM adds once the tools are good — on one synthetic benchmark.

## The hostile reviewer's sentence

"This is SpatialClaw's architecture applied to a CLEVR-style toy with a hand-written geometry library that
does all the work; the LLM contributes nothing, the benchmark has ten rooms and was tuned on, and the
'world model' is a JSON list."

Our answer, which the paper must make explicitly: (1) yes, the library does most of the work — we measure
exactly how much, and that measurement is a finding, not an embarrassment (VADAR reached the same
conclusion for QA); (2) the benchmark is small and synthetic and the claims are scoped to it, with a
held-out set reported; (3) the LLM's remaining roles are the ones the geometry cannot do (count, colour,
split blobs, decide when to stop) and the harness that makes a 3-cent, one-call, no-infrastructure
deployment possible; (4) "world model" is defined on first use in the state-estimation sense with the
predictive-model literature cited as distinct.

## What would falsify the novelty claim

A paper doing two-view uncalibrated explicit state with orientation, training-free, with cost. Searched
for it with 37 own queries plus ~37 in three theme subagents across arXiv (and Crossref); combinations of
{training-free, zero-shot} × {multi-object, scene} × {two-view, uncalibrated} returned no such work. The
nearest near-misses are listed above. Residual risk: CVPR 2026 papers without arXiv records (GCA,
SpaceTools, RieMind named in SpatialClaw's related work) — QA agents per their descriptions.
