# Submission checks (arXiv) — 2026-09-06 (revision) and 2026-09-05 (run 1)

## Revision, 2026-09-06 (thesis re-chosen around the helper; skill v0.3.0)

| Item | Result |
|---|---|
| `build.sh --strict` | pass: 0 errors, 0 undefined refs/citations, 0 overfull > 10 pt, 19 pages, all fonts embedded (`pdffonts`: 0 non-embedded) |
| `check_refs.py` | pass: 50 bib entries, 50 cited keys, 0 orphans (bibliography unchanged since run 1, where every id/DOI resolved) |
| Title ≤ 150 chars | 126 chars: "Explicit Scene State from Two Uncalibrated Views Without Training or a Model: How a Cheap Vision LLM Was Tuned Out of the Loop" |
| Abstract ≤ 1920 chars | 1,334 chars, 214 words (contract 200; the excess is the 89.6/95.9 qualification and the intervention-scope clause the framing review required) |
| Clean-directory build + bundle | pass (`bundle.sh`: 19 pages, `build/arxiv-bundle.tar.gz` 112 KB); `main.bbl` shipped |
| Tables/figures | only `tables/llm_vs_pipeline.tex` regenerated (column order; `scripts/analyze_bench.py`); figures byte-identical in content and restored from git; no number changed |
| Reviews | framing review by a fresh-context subagent (`08b-review-framing.md`): minor revision, all points fixed except five pre-existing body numbers (deferred, sources named in text) |
| Categories, license, authors, disclosure, limitations | unchanged from run 1 (below) |

Open before upload (user actions): unchanged from run 1 — confirm author line and license; add a LICENSE file;
optionally run the recommended API experiments (06-experiments.md).

## Run 1, 2026-09-05

| Item | Result |
|---|---|
| `build.sh --strict` | pass: 0 errors, 0 undefined refs/citations, 0 overfull > 10 pt, 18 pages, all 36 fonts embedded |
| `check_refs.py --resolve` | pass: 50 bib entries, 50 cited keys, 0 orphans, all 46 arXiv ids and 4 DOIs resolved (arXiv export API / Crossref). Full 87-entry working bibliography kept in `literature/refs-all.bib` |
| Title ≤ 150 chars | 145 chars |
| Abstract ≤ 1920 chars, ≤ ~200 words | 1,310 chars, 202 words; no macros beyond `\,` and `\%` |
| Authors / affiliation / email | James, independent researcher, San Francisco, astrojams1@gmail.com — as instructed |
| Categories | primary cs.RO; cross-list cs.CV, cs.AI (chosen in 05-decisions.md; set at upload) |
| License | arXiv default non-exclusive license (user to confirm at upload). Repository has no LICENSE file — stated in the paper; add one before submission |
| Figures | vector PDF (frontier, capacity); JPEG feeds at native 640×480 (renders, not photographs); all ≥ 300 dpi-equivalent at print width |
| Source size | bundle 112 KB (`build/arxiv-bundle.tar.gz`) |
| Clean-directory build | pass (`bundle.sh`: latexmk from a temp dir with only bundle contents, 18 pages); `main.bbl` shipped |
| Code/data availability | URL + both commits stated (released `d3b8a2d`, final-configuration helper `3744bdf`); paper source and experiments under `paper/cheap-world-model/` |
| AI-assistance disclosure | present (Disclosure paragraph) |
| Limitations | present and specific (§9) |
| No "under review"/anonymisation leftovers | none |
| Fresh-context proofread | done (28 items; all fixed except cosmetic 20 — "95 %" spacing in table header — kept) |

Open before upload (user actions): confirm author line and license; add a LICENSE file to the repository; optionally run the recommended API experiments (06-experiments.md) and refresh Tables 3/5 — the paper is written so that it stands without them.
