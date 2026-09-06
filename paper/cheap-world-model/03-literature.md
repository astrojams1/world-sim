# Literature

Search performed 2026-09-05 through the arXiv export API (plus Crossref for four non-arXiv papers and an
arxiv.org/search fallback while the API rate-limited). Raw responses and the query log are in
`literature/` (`search-log.tsv`, `arxiv-*.xml`); annotated notes per theme in `literature/notes-{A,B,C}.md`;
abstracts in `literature/abstracts-*.md`; every entry in `refs.bib` (87 entries) was produced from a
resolved record by `arxiv_bib.py` or hand-written from Crossref JSON with a DOI.

## Themes and the works that matter

**A. VLM/LLM + code/tools for spatial reasoning** (`notes-A.md`, 25 works). The systems pattern we use —
a training-free VLM writing Python cells in a persistent kernel preloaded with perception/geometry
primitives, with images fed back — exists: SpatialClaw (cho2026spatialclaw), and in single-pass form
pySpatial (luo2026pyspatial), VADAR (marsili2025visual), ViperGPT/VisProg (surs2023vipergpt,
gupta2022visual). Multi-view training-free agents that keep an explicit scene state internally exist:
S-Agent (dai2026s), Think3D (zhang2026think3d). The *task* of emitting explicit primitive-scene code with
matched position/scale metrics exists open-loop: SpatialBabel (liu20263d). The trained counterpart of our
output on CLEVR-like images is IG-LLM (kulits2024re: L2 position error 0.16–0.21, >99 % attributes, after
4k training images, single view). Cost per sample is reported by Visual Sketchpad (hu2024visual:
$0.06–0.13, 12–27k tokens). VLM low-level-vision and multi-view limits motivating tool use: BlindTest
(rahmanzadehgervi2024vision), VSI-Bench (yang2024thinking), MV-RoboBench (feng2025seeing).

**B. Analysis-by-synthesis / inverse graphics / metrics** (`notes-B.md`, 30 works). Definitions:
Yuille & Kersten 2006; Picture (kulkarni2015picture), DC-IGN (kulkarni2015deep). Closest in inference: 3DP3
(gothoskar20213dp3: render-and-compare in a probabilistic program, enumerates the cube's 24 symmetries,
depth + known camera; RGB-only variant "does not require training", 0.5 s/frame, qualitative) and Bayes3D
(gothoskar2023bayes3d: GPU SMC, RGB-D, no neural training). Closest in representation: Neural Scene
De-rendering (wu2017neural: per-object XML with position and yaw/pitch/roll; trained; single view; error
metric without symmetries). CLEVR (johnson2016clevr) defines the primitive-scene universe; the object-centric
line (MONet, IODINE, Slot Attention, uORF, ObSuRF) is trained and outputs masks/latents. Metric: BOP 2020's
MSSD/MSPD (hodan2020bop) minimise pose error over a symmetry set; BOP localisation gives instance counts,
BOP 2024 adds detection. Training-free 6D pose work (FoundationPose, MegaPose, FreeZe, FoundPose, SAM-6D)
is single-image, per-object, known intrinsics. Camera from a known cuboid: P4Pf (bujnak2008general).

**C. World models and real-to-sim** (`notes-C.md`, 32 works). "World model" dominantly means a learned,
action-conditioned predictive model (ha2018world, hafner2020dream, hafner2023mastering, assran2025vjepa,
nvidia2025cosmos); wang2026world states a perception module "is not itself a world model unless it models
temporal change"; ding2024understanding and chen2026definition recognise an "understanding-the-present"
branch that includes state estimation. Real-to-sim: Digital Cousins / ACDC (dai2024automated: training-free,
GPT-4o-orchestrated, single calibrated RGB + monocular depth → interactive scene; 4–16 cm centre and
0.03–0.12 rad orientation error; ~7 s + 20 s per object; no $), URDFormer (chen2024urdformer, trained,
single RGB → URDF), Real2Code (mandi2024real2code, fine-tuned CodeLlama; its zero-shot GPT-4 baseline lost),
Agentic Real2Sim (chen2026agentic: VLM makes schema-constrained decisions, deterministic geometry tools do
the work; reports model bills per 100 episodes). Object-centric world models for manipulation: FOCUS
(ferraro2023focus), Goal-VLA (chen2025goal: "object state representation is the golden interface").

## Consequences for the paper

1. Do not claim the systems pattern (SpatialClaw), scene-as-code (SpatialBabel), "first VLM agent with a
   scene state" (S-Agent), or "first to report cost" (Sketchpad).
2. Claim the niche none fills: two *uncalibrated* RGB views, self-calibrated from the scene itself, to an
   explicit per-object state including size and orientation, scored with a symmetry-invariant metric, with
   no training of any component, at a stated per-scene cost — plus a measured LLM-vs-pipeline decomposition
   (VADAR's oracle analysis is the precedent to cite for that decomposition).
3. Use "world model" only as "explicit world-model state"/"simulator-ready scene state" with the
   disambiguation sentence from `notes-C.md`; cite the definitional papers.
4. Baselines a reviewer will expect to see discussed: IG-LLM (trained, single view), ACDC (training-free,
   real images, calibrated), 3DP3/Bayes3D (inverse graphics with depth), the VLM alone without tools (we have
   the gpt-4.1-mini "answers without code" observation; a proper run is a recommended experiment).

## Search log summary

Theme A: 8 queries; Theme B: 19 queries; Theme C: ~10 queries + web fallback; my own: 37 queries (four
batches in `search-log.tsv`). Terminating condition: the last two queries of each theme returned no new
relevant work.
