# Scientific review — cheap-world-model — 2026-09-05

Reviewer stance: hostile but fair, RSS/CoRL/ICRA perception reviewer; LLM-agent researcher as second reader.
Rubric A applied item by item; numbers spot-checked against `experiments/analysis.json`,
`bench/results/*.json`, `bench/BENCH.md`, `experiments/offline-default.json` (re-scored with
`scripts/score_rows.ts`), `src/lib/score.ts`, `src/lib/sandbox/worldsim.py`, `experiments/system-prompt.txt`
and the git history of `src/lib/sandbox/worldsim.py`.

## Summary

The paper claims that a cheap VLM orchestrating a 2,000-line classical analysis-by-synthesis helper inside a
code sandbox recovers the full explicit state of a synthetic two-view scene at 99.5/100 for 22 s and $0.032,
that the accuracy came from moving work into the tools, and that the model's marginal contribution on the
benchmark is zero. The headline numbers, the trajectory and the pipeline-alone ablation are all traceable to
the result files and reproduce (I re-scored the offline ablation and got 99.48 / 99.61), and the paper is
unusually candid about the LLM adding nothing. But three things undercut the scientific claims as written: the
"held-out" set was used to select helper changes and to diagnose specific rooms, so the 99.6 is a validation
number, not a held-out one; the released helper is not the helper that produced the record, and the default
benchmark was never run through the API with it; and the paper's own capacity runs show the model changing the
answer (+4.2 and −9.4 points on the rooms where it ran more than one cell), which contradicts "identical room
for room" at ten objects. Verdict: **major revision** — fixable cheaply (most of what is needed costs nothing
or about $1 of API), but the claims must be rescoped to what the data show.

## Major points

1. **The "held-out" set is a validation set, and the paper says otherwise.**
   *Location:* §3 "Benchmark protocol" ("Seeds 201–210 are a held-out set used only offline … never for a
   record decision"); §6 para 1 ("which no tuning decision was ever based on with the API and which were only
   ever used to reject helper changes that hurt them offline"); Table 5 caption; abstract ("scores 99.6 on a
   held-out set").
   *Problem:* The repository's own protocol (`tune-skill/SKILL.md` §Procedure step 6) says a helper change
   that is neutral on the benchmark "but clearly better on the offline held-out set may be kept"; that clause
   was exercised at least twice. Iteration 8 was kept for a "large held-out gain" (93.0 → 95.6). Iteration 25
   was *designed* by inspecting held-out room 210 ("Held-out room 210 had the only shape error left across 20
   rooms … Now a blob shared in exactly one view is judged from the other view alone") and merged because
   held-out rose 98.8 → 99.6 — that is the very 99.6 the abstract reports. Iteration 24's diagnosis also names
   held-out room 204. So seeds 201–210 were used to *accept* changes and to *choose* what to change, which is
   model selection on the set that is then reported as an overfitting guard. The sentence in §6 is false as
   written.
   *Why it matters:* Rubric items 4 and 1. For this audience the whole "tuned on ten rooms" objection rests
   on the held-out number; if that number is itself selected on, the paper has no evidence against overfitting
   to the generator's quirks other than the rooms' being drawn from the same generator.
   *Fix:* (a) Rename 201–210 a "development held-out"/validation set everywhere and state exactly how it was
   used (kept iter 8; motivated and accepted iter 25; diagnosed 204/210). (b) Add a genuinely untouched test
   set, run **offline** (it costs nothing): e.g. seeds 301–400 at the default draw and 301–330 at 6/8/10/12
   objects with the released helper, and report mean ± bootstrap CI with the same prominence as 99.5. A
   100-room offline number would also answer point 5. (c) Only then call anything "held-out".

2. **The released helper is not the helper that produced the record, and the default benchmark was never run
   through the API with it.**
   *Location:* §6 para 1 ("ran `solve_all` … with the same helper file"); §9 "Reproducibility" (commit
   `d3b8a2d`); Table 4 caption; abstract ("Running the helper alone … reproduces the record scores room for
   room").
   *Problem:* `git log -- src/lib/sandbox/worldsim.py` shows the record runs (iter23, 09:05 and 09:12 UTC)
   used the helper at `3744bdf`; four helper commits follow (`e1da832` iter25 shared-blob shape rule 09:19;
   `9e582db` tighter pairing 11:27; `9bafd95` frame tie-break 11:50; `f034ba6` 12:05). `run_offline.py`
   copies `src/lib/sandbox/worldsim.py` at HEAD, i.e. the post-capacity helper. The last API run on seeds
   101–110 is iter25 (09:18), before the pairing and frame-alignment changes. So Table 4 compares "LLM + tools
   with helper v(iter23)" against "pipeline alone with helper v(final)"; the per-room identity is a coincidence
   of the changes being neutral on these rooms offline, not evidence that the model copied the printout of the
   same program. And a reader who checks out `d3b8a2d` and runs the benchmark is running a configuration for
   which the paper has no API result on the default rooms.
   *Why it matters:* Rubric items 2 and 6. The reproducibility statement is the paper's contract with the
   reader; the ablation is its central claim.
   *Fix:* Either re-run the API on 101–110 with the released helper (two runs, $0.64, 10 minutes) and make that
   the record, or state plainly in §6 and §9 which commit produced the record, which commit the ablation and
   capacity `-b` runs use, and that offline scores on 101–110 are identical under both. Also run the offline
   ablation with the iter23 helper (`git show 3744bdf:src/lib/sandbox/worldsim.py`) so that Table 4 is an
   apples-to-apples row.

3. **"Identical room for room" at ten objects is false, and the model's marginal contribution is not zero
   where it actually intervenes.**
   *Location:* §6 last para ("at eight and ten objects the model-in-the-loop runs are again identical room for
   room to the pipeline"); Fig. 2 caption ("The two coincide within run noise"); §5 "Capacity"; abstract and
   §1 finding (iii) ("the model's marginal contribution on these rooms is zero").
   *Problem:* Comparing `bench/results/capacity-*.json` with `analysis.json["offline-capacity"]` (same final
   helper for `-b`, `-confirm` and `capacity-10`):
   - capacity-6-b room 110: API 98.6 vs pipeline 94.4 (model ran 2 cells; it corrected a shape) → **+4.2**.
   - capacity-10 room 110: API 86.2 vs pipeline 95.6 (model ran 4 cells; returned 9 objects for 10, i.e. it
     deleted a real object) → **−9.4**. This single room is the entire 89.5-vs-90.4 gap in Table 3.
   - Every other capacity room where the model ran 2 cells (6-b: 106; 8-b/confirm: 110; 10: 103, 108) is
     identical.
   At the record the model runs one cell in all twenty room-runs (`codeRuns` = 1 throughout both iter23 files),
   so "zero" there is a statement about a prompt that forbids the model from doing anything, not a measurement
   of what it can do. The run-to-run noise at the record is exactly 0, so the 0.9-point gap at ten objects is
   not "run noise"; it is the model.
   *Why it matters:* Rubric items 1, 5, 6. The finding the LLM-agent reader will take away is "when the model
   does intervene, it is as likely to hurt as help" — that is more interesting than "zero" and it is in the
   data, but the text currently states the opposite of what the files show.
   *Fix:* Add a small table: every room-run with the final helper in which `codeRuns` > 1, with API score,
   pipeline score, delta and what the model changed (from the transcripts). Rewrite §6's last paragraph and
   the abstract/finding (iii) as: zero on the default benchmark (where the prompt confines the model to one
   cell), and of both signs (+4.2, −9.4, otherwise 0) on the six capacity room-runs where it ran more than one
   cell. Correct Fig. 2's caption.

4. **The VLM-only baseline is missing, and it is the one baseline this audience will not forgive.**
   *Location:* §1 para 2 ("VLMs cannot answer this on their own", supported only by citations); §10 (ii)
   listed as a recommended experiment; 05-decisions.md names "VLM alone" as an expected baseline.
   *Problem:* There is no number for gpt-5-mini (a) with no sandbox and (b) with a sandbox but without
   `worldsim.py`. The repo has only an anecdote about gpt-4.1-mini. Iteration 0 is not a baseline: it already
   contained the helper's primitives. Without (a)/(b) the paper cannot support "how cheap can the state get
   without training" — the cheapest configuration ($0.002, no sandbox) is unmeasured — nor the intro's
   assertion that the model cannot do it alone on *this* benchmark, whose black background, two colours and
   0.05 grid are far easier than the cited failure cases. For the second reader, (b) is the actual test of an
   agent that writes its own geometry.
   *Why it matters:* Rubric item 3. Two ten-room runs cost $0.64 and one prompt flag.
   *Fix:* Run (a) and (b) at low and medium effort on 101–110 (four runs, ≈$1.30) and put them as rows above
   the record in a baseline table; report cells/tokens/time too. If (b) at medium effort reaches, say, 60,
   the "tool library" framing gains a quantitative anchor; if it reaches 90, the paper's framing changes.

5. **Ten rooms, one seed set, and every claimed difference is at 0.1-point resolution; no sampling
   uncertainty is given anywhere.**
   *Location:* §3 protocol; §5 (99.5, 97.7, 95.9, 89.5); §7 "Run-to-run variance"; Table 3.
   *Problem:* §7 reports *run-to-run* variance thoroughly (and honestly: it collapses to 0 once the model runs
   one cell), but the numbers that matter to a reader — mean score at n objects, capacity = 8 — are estimates
   over the generator distribution from ten rooms, and 38 objects. The capacity rule's threshold of 95 is
   passed at 8 by 0.9 points, on ten rooms, one of which (107, at 83.6) accounts for most of the loss. With
   ten rooms a single merged-blob room moves the mean by 1–2 points, i.e. the capacity verdict is one room
   away from flipping. Because the pipeline is deterministic and free offline, there is no reason to leave
   this at n = 10.
   *Why it matters:* Rubric items 5 and 7; "capacity is eight" is a headline claim.
   *Fix:* Offline, 100+ fresh seeds per object count (2–12), mean with bootstrap CI, and a per-count
   histogram of "objects missing". Keep the ten-room API numbers as the model-in-the-loop check. State the
   sampling CI wherever a capacity or held-out number is quoted.

6. **The thesis "accuracy came from moving work into the tools" is supported only by a correlational
   trajectory, while the decisive series — the offline floor per iteration — is in BENCH.md and absent from
   the paper.**
   *Location:* §7 "Work moved from the model to the tools"; Fig. 3; Table 6; §6 ("It was not always zero …
   transcripts of iterations 2–8 show the model adding merged objects").
   *Problem:* Iterations changed helper accuracy, prompt, effort and cell caps together; Fig. 3 shows score,
   time, tokens improving together, which is consistent with "the helper got better" as much as with
   "work moved". The paper has the number that separates them: BENCH.md records the *offline automatic
   pipeline* score at iterations 2 (76.1 → 90.0), 5 (90.9), 7 (94.6), 8 (94.3), 14 (96.6), 15 (96.4), 16
   (98.3), 17 (98.3), 18 (99.4), 21 (99.5). API minus offline is the model's marginal contribution per
   iteration: about +14 at the baseline helper (90.0 vs 76.1), +1 at iteration 2, ≈0 from iteration 7 on. That
   series *is* the thesis, and it is not in the paper; §6's "It was not always zero" is argued from anecdotes.
   *Why it matters:* Rubric items 1 and 6.
   *Fix:* Add an "offline floor" column to Table 6 and a fourth panel (or a line) to Fig. 3, and quote the
   +14 → 0 trajectory in §6 and the abstract. Mark clearly which iterations have an offline number.

7. **"Training-free": the helper contains constants fitted on labelled data of undisclosed provenance, quite
   possibly the benchmark and held-out rooms themselves.**
   *Location:* title, abstract ("no training at all"), §4 "Analysis by synthesis" ("size-specific thresholds
   measured on 130 blobs"), §9 Limitations ("measured on 130 blobs from the same generator").
   *Problem:* `worldsim.py` l.1123: `_FLAT_THRESHOLD = {0.10: 0.20, 0.15: 0.32, 0.20: 0.48}` are "midpoints
   between sphere and cube medians measured on 130 blobs" — a supervised fit (it needs the true shape per
   blob). The 20 benchmark + held-out rooms contain 76 objects ≈ 130–150 visible blobs; nothing in the repo
   says which rooms were used. l.899: the pairing threshold 0.16 comes from "correct pairs have ray gaps up to
   0.075, 99th percentile 0.058" — again a statistic of correct pairs over some room set. l.523: "checked on
   40 cameras" = exactly the benchmark + held-out cameras. If the shading thresholds were fit on 101–110 /
   201–210, the shape decision (iteration 7, +3.95 points, the largest single accuracy gain in the log) was
   trained on the test set, and the held-out set is contaminated a second time.
   *Why it matters:* Rubric items 4 and 11; "training-free" is in the title.
   *Fix:* State in §4 and §9 which seeds the 130 blobs and the ray-gap percentiles came from. If they overlap
   the reported rooms, re-measure on fresh seeds (offline, free), re-run the offline ablation and held-out
   numbers, and report any change. Scope "training-free" on first use: "no learned component beyond the
   hosted VLM; three helper constants were fitted on labelled blobs from seeds X–Y".

8. **The stated record rule does not produce the stated record.**
   *Location:* §3 "Benchmark protocol" (record = +1.0 mean, or within 1.0 with −20 % cost or −30 % time);
   §5 and Table 1 (record = iteration 23); Table 6.
   *Problem:* BENCH.md l.76: iteration 23 became the record "under the pure-win clause (two-run mean 99.5 =
   record score; tokens 6,274, −7 %; time 22.3 s, −4.5 %, within run noise)". The pure-win clause
   (`SKILL.md`: "a pure cost/time win with no score loss … treat it as a record") is not in the paper. Under
   the paper's own rule the record is iteration 22 (99.5, 23.3 s, 6,773 tokens, $0.032). The same clause
   also promoted iterations 19–21 as bases. Similarly, iteration 16 is a record in BENCH.md (two-run mean
   98.3) but Table 6 shows its confirmation at 88.3 because room 107's moderation rejection is counted as 0
   in the raw file while the substituted rerun (`iter16-confirm-107-rerun.json`, 100) is silently excluded;
   iteration 4's confirmation, by contrast, has the rerun patched *into* the file. §7 says "one API-side
   error", §8 says "two … rejected", BENCH.md says room 107 was rejected twice (so at least three
   rejections, one of them after the retry the protocol promises).
   *Why it matters:* Rubric item 2 — a reader cannot reproduce "which run is the record" from the rules
   given, and the error accounting is inconsistent across three sections.
   *Fix:* State the pure-win clause in §3. Footnote Table 6 at iterations 4 and 16 with the rejected request,
   the retry, the rerun file and the substituted mean. Give one consistent count of API-side rejections
   (requests rejected / retried / substituted) in §3 or §7 and use it in §8.

9. **The metric in §3 does not match the scorer.**
   *Location:* §3 "Score", Eq. (1) and the sentence after it.
   *Problem:* (a) "position and size credit decay linearly to zero at 0.35": `score.ts` l.125–126 — size
   credit reaches zero at 0.012 + 0.15 = 0.162, position credit at 0.03 + 0.35 = 0.38. (b) "π ranges over
   injective assignments … (exhaustive)": the scorer uses the Hungarian algorithm (`assignMax`); equivalent
   in value but not what is stated, and the code's own docstring is stale in the same way. (c) The scorer
   clamps the penalised score at 0 and caps any non-exact room at 99.9 (l.241, 254) — Table 1's 99.9 for room
   104 is that cap, and a reader of Eq. (1) cannot know it. (d) Orientation credit is only awarded if the
   predicted shape is also a cube (l.131); Eq. (1) does not say so.
   *Why it matters:* Rubric item 2; the metric is one of the claimed contributions (C4).
   *Fix:* Correct the constants (or the code, but then re-score everything), replace "exhaustive" with the
   assignment actually used, and state the 99.9 cap and the shape-gating of orientation credit.

10. **Method text contradicts the code in several places.**
    *Location:* §4 "Detection, matching, hypothesis"; §4 "Analysis by synthesis"; §4 "What is left to the
    model".
    *Problem:* (a) "capped at the six largest blobs per color": no such cap exists in `_match_cost` /
    `auto_match` (Hungarian over all blobs, "any number of objects is tractable"); the cap was iteration 3
    and was removed. (b) "a cube … must win by a margin (0.06 IoU, halved for the smallest size)": l.1199,
    `scale = clamp(size/0.15, 0.5, 1)` gives 0.667 for 0.10, not 0.5; the sphere-direction margin of 0.03 is
    not mentioned. (c) "In the record configuration nine of ten rooms finish in one cell and the tenth in
    two": both iter23 files show `codeRuns` = 1 for all ten rooms (the 9/10 figure is iteration 19).
    (d) §7 "every record after iteration 7 was either a score gain with a time gain or a pure time/token
    gain": iteration 16 was a record with +1.9 score and +23 % time (BENCH.md l.63).
    *Why it matters:* A robotics reviewer will read the helper; each mismatch costs credibility for the
    numbers they cannot check.
    *Fix:* Re-derive §4 from the released `worldsim.py` and cite line numbers; fix the three sentences above.

11. **The framing "for three cents" prices a component the paper shows to be unnecessary.**
    *Location:* Title; abstract; §1 question ("how cheap can a complete, explicit scene state get if nothing is
    trained?"); §11 Conclusion ("the cheapest world model without training is a good tool library and a
    model that knows when to call it once").
    *Problem:* By the paper's own Table 4, the same state is obtained with no model, no sandbox, and ~10 s on
    two vCPUs (well under $0.001 of cloud compute). The $0.030 of the $0.032 is the sandbox session, i.e. the
    price of running the helper *behind an API* rather than locally; the model itself costs $0.002 and
    contributes nothing. So the honest answer to the question posed in §1 is "essentially free", and the
    title's three cents is the cost of a deployment convenience. The conclusion's "a model that knows when to
    call it once" is not a finding: the prompt tells it to call it once. 05-decisions.md already rejected
    "the world's cheapest world model" for this reason; the title and conclusion reintroduce the claim.
    *Why it matters:* Rubric items 1 and 10 — overclaiming by framing, which this audience penalises harder
    than a missing experiment.
    *Fix:* Either reframe the three cents explicitly as "one hosted call, no infrastructure" (and give the
    $0-and-10-s pipeline-alone row in the abstract next to it), or retitle around the actual finding
    (training-free two-view explicit state; the LLM adds nothing once the tools are good). Rewrite the last
    sentence of the conclusion so it does not credit the model with a decision the prompt makes for it.

12. **The effort ablation compares means over different room sets.**
    *Location:* §7 "Reasoning effort" ("Excluding the two empty answers the low-effort mean was 95.8 against
    94.3 for medium").
    *Problem:* 95.8 is over 8 rooms; 94.3 is medium over all 10, including the two rooms (101, 109) that
    low effort emptied — and BENCH.md says the 8 rooms were *identical* between low and medium. On the
    same 8 rooms the two settings are therefore equal, and the sentence as written suggests low beats medium.
    *Fix:* Report both effort settings on the same 8 rooms (equal), state the 2 failures separately, and drop
    the 95.8-vs-94.3 comparison. Also note it is a single run per setting.

## Minor points

1. §5 "Record configuration" and §8 (1)/(3): the 0.071 error in room 101 is on the red 0.15 **cube**, not a
   sphere (iter23-confirm guess vs truth: cube [0.5,0.65,0.65] vs true [0.55,0.6,0.65] after the frame flip).
   Fig. 1's caption has it right ("one cube centre"); the body text is wrong twice, and "after a size change"
   in §8 is unsupported. "1.4 grid steps" is one step in each of two axes; say so.
2. §6: held-out misses are "a cube orientation and two centres" — Table 5 shows three orientation errors (16°,
   23°, 15°) and three position errors across rooms 204, 205, 210.
3. Table 6 caption "Every benchmark run in bench/results/" — 39 rows from 48 files: `iter9-diag`,
   `iter4-confirm-108-rerun`, `iter16-confirm-107-rerun` and the six capacity files are omitted; say which.
4. Table 1 caption says tokens are run 2 but does not say the seconds column is also run 2 (it is: mean
   23.4 s, not the 22.3 s in the text). State both.
5. §3 "Observation": the prompt (Appendix A) also tells the model that objects never touch each other or the
   walls, that room surfaces are never red or blue, that objects float, and the 0.05 grid; §3 says "the object
   vocabulary above" — list the givens explicitly in one place so the "denied" list is checkable.
6. §4 "Self-calibration": the helper also refuses fits with f outside (10, 20000) px and points closer than
   0.05 to the camera, uses 60 random starts for six points, and skips random starts if the DLT refines to
   worse than 3 px — the 3 px skip is mentioned only in Table 6. One sentence with these numbers.
7. §2, IG-LLM "L2 position error 0.16–0.21 after 4k training images" and Visual Sketchpad "$0.06–0.13 and
   12–27k tokens": I could not verify these from the repo; the writing/citation pass should check them
   against the papers.
8. Related work: no classical two-view baseline is argued away. One sentence on why SfM/COLMAP-style
   pipelines do not apply (two views, textureless flat colours, no intrinsics) would pre-empt the question.
9. §5 "Cost and latency anatomy": give the date of the list prices in the text (it is only in §7's
   2026-09-05 and the limitations), and say whether the $0.03 sandbox price is per container or per call.
10. §10 (v) "physical unit-cube room" is not an experiment the paper can claim as "a single command in the
    repository"; move it out of that sentence.
11. Ethics/disclosure: AI-assistance disclosure present; no credentials found in the paper or result files.
    No licence is stated for the code, benchmark or result files (no LICENSE in the repository) — add one.
12. Eq. (1): the max over π should be a max over partial injections from S into Ŝ with unmatched true objects
    scoring 0; as typeset it reads as a max over injections of the *true* set, which need not exist when
    |Ŝ| < |S|.
13. Table 3: the six-object entry is the `-b` run only, while the eight-object entry is a two-run mean; the
    header says "(two-run)". Label per row.
14. Fig. 3 caption: "Iterations 0–8 used medium reasoning effort, 9–25 low" — fine, but the figure should
    also mark the record iterations, since the text refers to "every record after iteration 7".

## Numbers checked (rubric item 9)

| Paper | Value | Source | Result |
|---|---|---|---|
| Record mean / s / tokens / $ | 99.5 / 22.3 / 6,274 / 0.032 | `analysis.json["record"]`, BENCH.md l.14 | match (22.25, 6273.5) |
| Wall clock two runs | 115, 134 s | `analysis.json["record"]["wall_clock"]` | match (114.8, 134.3) |
| Run-2 token anatomy | 5,783 / 2,726 / 417 / 147 | `record_tokens` | match; $0.0017 at the quoted prices |
| Per-room Table 1 tokens/seconds | e.g. 101: 6,832, 28 s | `iter23-…-confirm.json` | match (run 2; seconds mean 23.4) |
| Totals | 48 files, 454 rooms, 5.1 M tokens, $16.07, 1 API error | `analysis.json["totals"]` | match; but see major 8 on the error count |
| Variance | 14 pairs, 139 room pairs, 84 %, p90 7, max 27, max mean diff 10.0 | `analysis.json["variance"]` | match |
| Effort | 95.8 excl. empties vs 94.3 | `analysis.json["effort"]` | match numerically; comparison invalid (major 12) |
| Capacity API | 97.7 / 95.9 / 95.9 / 89.5 | `capacity-*.json` summaries | match |
| Capacity offline | 97.3 / 95.9 / 90.4 / 80.8; missing 0/1/5/13 | `offline_capacity_summary` | match |
| Offline default / held-out | 99.5 (6 exact) / 99.6 (7 exact) | re-scored `offline-default.json` with `score_rows.ts` | 99.48 / 99.61 — match |
| Pipeline = LLM room for room (Table 4) | identical ×10 | iter23-confirm vs offline-default | match on 101–110; **not** on capacity rooms 110@6, 110@10 (major 3) |
| Cells at record | "nine of ten in one cell" | `codeRuns` in both iter23 files | **wrong**: 10/10 in one cell |
| Score tolerances | 0.03 / 0.012 / 10°, decay to 0.35 / 45° | `score.ts` l.4–8, 125–133 | tolerances match; **decay constants wrong** (major 9) |
| Blob threshold / min area / chroma margin / random starts | 150 px, 45, 150 starts, 600 for five points, 5 FoVs | `worldsim.py` l.103–104, 434, 485, 917, 1638 | match |
| Six-blob cap; margin halved | — | `worldsim.py` l.838–915, 1199 | **stale / wrong** (major 10) |
| Helper length | "2,000-line" | `wc -l` = 1,968 | match |
| Tuning window | 11 h on 2026-09-05 | `totals.first/last` 01:47–12:31 UTC | match |

## Verdict: **major revision**

The one change that matters most: **replace the contaminated "held-out" number with a real one and rescope
the zero-contribution claim to what the files show.** Concretely: run the released helper offline on ≥100
fresh seeds per object count (free), report those with CIs as the held-out result, rename 201–210 a
development set with its uses listed, state which helper commit produced each reported run, and add the table
of the six capacity room-runs where the model ran more than one cell (+4.2, −9.4, four × 0). With ≈$1.30
more for the two VLM-only baselines, every remaining major point is a wording fix.

## Response (author)

Every point was acted on; the paper was rewritten around the fresh-test-set result that point 1 provoked.

1. **Held-out contamination — fixed, and it changed the paper.** Seeds 201–210 are now called the *development set*, with their three uses listed in §3 (kept iterations 8 and 25; diagnosed 204/210; rejected 26). A genuinely untouched *test set* was added and run offline with the released helper: seeds 1001–1100 (default draw) and 1001–1030 (8 objects), `experiments/offline-fresh.json`, Table 5. Result: **95.3 [93.4, 96.9], 58/100 exact** at the default draw and **89.6 [86.1, 92.9]** at eight objects — about four points below the tuned benchmark. This is now in the abstract, introduction, §6, §8, §9 and the conclusion. The 99.6 development-set number is reported as a selected number, not evidence of generalization.
2. **Released helper ≠ record helper — fixed.** The offline ablation was re-run with the record helper (`git show 3744bdf:…worldsim.py`, `experiments/offline-default-iter23helper.json`): identical to the API run on all ten rooms (99.48) and 98.8 on the development set, matching the log. Table 3 now has both helper columns; §3, §5, §6 and Reproducibility state which commit produced which number; the fact that no API run exists on 101–110 with the released helper is stated.
3. **Model intervention at capacity — fixed.** New Table 7 lists the 6 of 40 released-helper capacity room-runs with >1 cell: four unchanged, +4.2 (6-b/110), −9.4 (10/110). §6 and the abstract now say "zero where the prompt confines it to one cell, of both signs where it intervenes". "Nine of ten rooms in one cell" corrected to all room-runs. Figure 2 caption corrected.
4. **VLM-only baseline — not run (no API key in this session); moved to the front of §10 with the cost stated ($1.30), and §1 no longer claims the model cannot do it on this benchmark; it cites the general findings and says the baseline is unmeasured.**
5. **Sampling uncertainty — fixed** by the 100-room and 30-room test sets with bootstrap CIs; the ten-room capacity verdict is explicitly called "one room away from flipping".
6. **Offline floor per iteration — fixed.** `experiments/offline-floor-benchmd.json` transcribes the log's helper-alone numbers with line references; Table 8 and the fourth panel of Figure 3 show VLM + helper minus helper alone: +13.9 → +1.0 → ≈0 from iteration 7, exactly 0 from 15.
7. **Constants of undisclosed provenance — disclosed** in §9 (shading thresholds, pairing threshold; seeds unrecorded; may overlap the tuned rooms) and "training-free" is scoped on first use in §9; the test set is offered as the empirical answer. Re-measuring the thresholds on fresh rooms is left as future work (requires re-tuning).
8. **Record rule / error accounting — fixed.** Pure-win clause added to §3; one consistent statement of the three moderation rejections, how they were substituted, and why Table 9 shows 88.3 for 16b (also in the table caption).
9. **Metric — fixed**: decay-to-zero at 0.162 / 0.38 / 45°, Hungarian assignment, 99.9 cap, shape-gated orientation credit; Eq. (1) rewritten as a max over partial injections with the outer max(0,·).
10. **Method vs code — fixed**: six-blob cap removed; margins stated as 0.06/0.03 scaled by min(1, max(½, s/0.15)); pose-fit constants (3 px skip, 60 starts × 5 FoV, f range, 24/144 labelings) added; iteration 16's +23 % time stated.
11. **"Three cents" framing — reframed.** Title changed to the question ("How cheap can an explicit world model get without training?"); §5 Cost says the $0.032 prices a hosted call, not the reconstruction, and the conclusion says the cost floor is seconds of CPU with the tools alone.
12. **Effort ablation — fixed**: same eight rooms, identical scores (95.8 both), two failures reported separately, single run per setting stated.

Minor points: 1 (room 101 error is the red 0.15 cube; "one grid step along each of two axes") fixed everywhere; 2 fixed (three orientations, three centers); 3 fixed (Appendix C says what is omitted); 4 fixed (caption: time and tokens are run 2); 5 fixed (givens listed in full); 6 fixed; 7 — the IG-LLM and Sketchpad numbers were removed from the text rather than re-verified; 8 fixed (SfM sentence); 9 fixed (price date; per session); 10 fixed; 11 — no LICENSE exists; stated in Reproducibility as to be added; 12 fixed; 13 fixed (single runs marked); 14 — record iterations are identifiable from Table 9; figure left as is.

## Post-delivery finding (author, 2026-09-06) — the paper had the wrong subject

After the run-1 paper was merged, the author observed that its thesis ("a cheap vision LLM ... recovers the
complete explicit state") is contradicted by its own content: Table `llm_vs_pipeline` shows the helper alone
reproduces every benchmark answer, Table `floor` shows the VLM's contribution at exactly 0 from iteration 15,
and the fresh test set was run with no model at all. The problem the paper solved was solved deterministically;
the VLM was the scaffold the deterministic solution was built inside, and its contribution collapsing to zero is
the paper's second finding, not its framing.

This review's major point 11 offered two fixes — "reframe the three cents" or "retitle around the actual
finding" — and the run-1 response took the first. That was the wrong choice: candor about a zero inside the old
framing left the title, the abstract's first sentence, the system section (one call first, helper second) and
the results order (VLM + helper first, helper alone second) all making the VLM the actor of a result the helper
produced. Rubric A item 6 (attribution) was applied, but nothing in the skill required the thesis chosen at stage
6 to be re-tested against the stage 14 ablation.

**Revision (skill v0.3.0, ledger run `2026-09-06-world-sim-cheap-world-model`).** Thesis, title, contributions
and research question re-chosen (05-decisions.md, 01-, 02-, 07-). `main.tex`: new title and abstract;
introduction leads with the helper-alone results and then the VLM finding; Section 4 describes the helper first
and the hosted call last; Section 5 is "Results: the helper alone" (benchmark, development, test, capacity) and
Section 6 "The VLM in the loop" (record run, cost, latency, capacity with the model, interventions, contribution
per iteration); limitations and conclusion rewritten. No number changed; no table or figure changed; the
ablation table's caption now describes its role. A fresh-context framing review of the revised text is in
`08b-review-framing.md`. The skill now has a stage 14 thesis re-check gate, a stage 6 subject test, rubric A
item 12 and rubric B item 11 so that this is caught before the outline, not after the merge.
