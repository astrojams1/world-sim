# Submission checks (arXiv) — 2026-09-05

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
