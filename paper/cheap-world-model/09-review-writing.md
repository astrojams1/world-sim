# Writing review — cheap-world-model — 2026-09-05

Reviewed: `main.tex` and `build/main.pdf` (16 pages: 10 pages main text incl. conclusion, references pp. 10–13,
appendices pp. 14–16) against `05-decisions.md` and Rubric B of `reviews.md`. Page images were inspected for
float placement and figure legibility. No file other than this report was edited.

## Summary

The paper claims that a cheap VLM orchestrating a deterministic analysis-by-synthesis helper in a code sandbox
recovers the full explicit state of a synthetic two-view scene at 99.5/100 for about three cents, and that the
accuracy comes from the helper, not the model. The writing is generally direct and the structure is close to the
contract, but it drifts on three hard rules (British spelling throughout, abstract 288 words against a 200-word
limit, headline result not on page 1), repeats the same four record errors in three sections, uses five different
names for the two experimental conditions, and contains two factual mismatches between prose and tables (Figure 1
caption says "cube" for a sphere; Section 6 miscounts the held-out errors). Verdict: **minor revision** — every
point below is a text fix, none requires a new experiment.

## Major points

1. **Contract — American spelling (05-decisions, stage 12).** British spellings appear in the main text on almost
   every page. Every instance (code identifiers and the verbatim prompt in Appendix A are exempt):
   - "centre"/"centres": Fig. 1 caption ("one cube centre"); §2 real-to-sim ("4–16 cm centre error"); §3 Scene
     state ("centre $\mathbf{p}_i$", "around the room centre", "look near the centre"); §4 Detection ("triangulated
     centre"); §4 What is left ("pixel centres"); Alg. 1 line 5 ("triangulated centre"); §5 Record ("one sphere
     centre"); §6 ("two centres"); §8 ("sphere centre").
   - "synthesises" (§2, VADAR sentence); "recognise" (§2, world models); "minimise"/"minimisation" (§2 BOP,
     twice); "minimised" (§3 Score); "minimises" (§4 Detection); "localisation" (§2 BOP); "labelling"/"labellings"
     (§4 Self-calibration ×3, Alg. 1 line 2, Table 6 row 22 "skip poor labellings"); "initialisation" (§4 ×2);
     "generalises" (§7 Reasoning effort); "optimised" (§9); "bluish-grey" (§4 Detection).
   - Fix: global replace to center/synthesizes/recognize/minimize/minimization/localization/labeling(s)/
     initialization/generalizes/optimized/gray. Leave `experiments/system-prompt.txt` as is (verbatim), but say in
     Appendix A that the prompt keeps the repository's British spelling.

2. **Contract — abstract length.** The abstract is **288 words** (limit 200). It also contains two numbers for the
   same quantity ("6.3k tokens" then "tokens from 23k to 6k"). Cut: the first sentence's second clause ("and the
   learned models ... expensive to train and to run" — the intro says it), the helper's step list ("the helper
   calibrates ... comparing them with the photographs" — keep at most one clause), "(6.3k tokens)", "with six rooms
   reconstructed exactly", and the last sentence's "and we state precisely what the benchmark does and does not
   show" (self-praise). A 190-word version keeps: problem, one-sentence approach, 99.5 / 22 s / $0.032 / two-run
   protocol, the 90→99.5 while 232→22 s trajectory, helper-alone = same scores + 99.6 held-out, "synthetic" as the
   scope word, and the release sentence.

3. **Contract — introduction: result not on page 1.** The introduction runs from mid page 1 to 62 % of page 2
   (1.14 pages including Figure 1; 628 words), inside the 1.2-page limit, but page 1 ends in the middle of the
   "World Sim works as follows" paragraph; the reader reaches the headline number (99.5, 22 s, $0.032) and the
   surprising finding (the model contributes zero) only on page 2. Fix: move the "Our findings" paragraph ahead of
   the system-description paragraph, or cut the system paragraph to three sentences (the scorer sentence is
   repeated in §3 verbatim).

4. **Factual mismatch — Figure 1 caption vs text.** Caption: "the single remaining error is one **cube** centre
   0.07 units (1.4 grid steps) off." §5 Record, Table 1 and §8 say room 101's error is a **sphere** centre 0.071
   off. Fix the caption to "sphere", use 0.071, and pick one description of that error (see point 8).

5. **Factual mismatch — held-out errors (§6, para 1).** "the three misses are again a cube orientation and two
   centres within two grid steps." Table 5 shows three rooms with six errors: rooms 204 (pos 0.071; ori 16°; ori
   23°), 205 (pos 0.071) and 210 (ori 15°; pos 0.071) — three orientation errors and three position errors. Fix:
   "three rooms miss, with three cube orientations 15–23° off and three centres 0.071 off (Table 5)."

6. **Contract — the rejected thesis wording returns in the conclusion.** 05-decisions rejects "the world's cheapest
   world model" as "not defensible" and confines it to a motivating question. Conclusion, last sentence: "the
   cheapest world model without training is a good tool library and a model that knows when to call it once." Also
   "We think the negative half of that sentence is as useful as the positive half." Both are editorial; cut the
   second and rewrite the first without "cheapest": "for explicit scene state on structured scenes, a deterministic
   tool library plus a model that calls it once is the cost floor we found."

7. **Inconsistent names for the two conditions and the components.** The same thing is called:
   - the code: "helper", "classical helper", "helper module", "worldsim.py", "the pipeline", "the tools", "tool
     library", "the helper's automatic pipeline", "2,000 lines of classical geometry";
   - the two conditions: "Pipeline alone" (Tables 3–5, Fig. 2), "the helper alone" (abstract, intro (iii)),
     "LLM + tools" (Tables 3–4, Fig. 2), "model-in-the-loop" (§5, §6, Table 3 caption), "model plus pipeline"
     (§6 title), "the system" (abstract, intro), "with the model in the loop" (§5);
   - the model: "vision LLM" (title), "vision model", "language model", "VLM", "LLM", "cheap hosted vision model",
     "low-cost hosted vision model", "the model".
   Fix: define once in §1: *helper* = `worldsim.py`; *pipeline* = its `solve_all` call; *VLM* = the model; the two
   conditions are **helper alone** and **VLM + helper**, used verbatim in all section titles, table headers and
   figure legends (rename §6 "Helper alone versus VLM + helper").

8. **The same four record errors are narrated three times** (§5 Record configuration; §7 Negative results — rooms
   104/105/108 diagnosed; §8 Failure analysis — the same three kinds again with the same numbers). The §7 diagnosis
   ("true silhouette ambiguities ... coupled position–rotation local minimum (true pose 0.92–0.96 versus
   0.68–0.79)") is the substance of §8 and belongs there. Fix: §5 lists the errors in one sentence pointing to
   Table 1; §7 Negative results keeps only "iteration 24 did not help and worsened 105 (41°→52°); the diagnosis is
   in §8"; §8 carries the evidence. Also settle the description of the 0.071 error once: 0.071 = 0.05·√2, one grid
   step along each of two axes; the paper currently calls it "1.4 grid steps" (Fig. 1), "one grid step deep" (§5,
   room 108), and "within two grid steps" (§6).

9. **Results appear before the section that introduces them; method detail in results.**
   - §5 Capacity reports "the pipeline alone reaches 80.8 with twelve" and Table 3 / Fig. 2 (helper-alone data)
     before §6 has said what "pipeline alone" is or how it was run. Either move the offline capacity data into §6
     or put the one-sentence protocol ("we also ran the helper offline, §6") at the top of the Capacity paragraph.
   - §5 Capacity, last sentence ("A missing object is one that overlaps ... leaves no unexplained pixels to search
     for") is mechanism, repeated in §8. Cut from §5.
   - §5 Cost anatomy: "cost records were effectively closed from iteration 3 onwards; time and accuracy were the
     remaining levers" is a trajectory finding — move to §7.
   - §6 para 2 carries trajectory history (iterations 12, 2–8, 19) that belongs in §7 "Work moved from the model to
     the tools", and re-states the capacity hint from §5.

10. **Paragraphs with two or more claims** (contract: one claim per paragraph, first sentence carries it):
    - §5 "Cost and latency anatomy": cost breakdown, latency breakdown, and a trajectory claim. Split into "Cost"
      and "Latency".
    - §5 "Capacity": result, character of losses, mechanism.
    - §6 para 2: honesty point; history of model interventions; value of the harness; the unrun experiment; the
      capacity hint. Five claims in eleven lines.
    - §7 "Reasoning effort": the iteration-9 result; the truncation mechanism; "The lesson generalises" (a
      generalization from ten rooms and one model — soften to "on this task").
    - §7 "Run-to-run variance": statistics; explanation; confirming-run policy.
    - §8: one paragraph with three failure kinds, the capacity failure, and a sentence about moderation rejections
      that is not a failure of the method (move it to §3 protocol or §9).
    - §1 para 5: contributions; "world model" terminology; scope disclaimer.
    - §2 "VLM agents with code and tools" is 17 lines (> 12) and "World models and real-to-sim" 13 lines.
    - §3 "Benchmark protocol": set definitions, record rule, retry rule, accounting. Split into "Sets" and "Record
      rule and accounting".

11. **Figure 3, left panel — annotation collides with the legend.** The text "two empty answers (iter 9)" sits on
    top of the legend box ("medium effort" / "low effort") and its leader line runs through the legend to the
    point at (9, 76.6). Fix: put the legend in the right-hand panel (or outside the axes, below the three panels)
    and place the annotation to the right of the iteration-9 point at y≈80. Also "x offset marks confirmations"
    (caption) is not visible at print size — use an open marker for confirmation runs and say so in the legend,
    or drop the sentence. The caption's "9–25 low" and the text's "26 tuning iterations" plus references to
    "iteration 26" (§7, §8) do not agree: iterations 0–26 are 27; state the numbering once ("iterations 0–26,
    of which 24 and 26 were offline-only").

12. **Appendix C is an empty section.** The heading "C All benchmark runs" is followed directly by "D Notation";
    Table 6 (placed `[h]`) floats to page 16 after Appendix D. Fix: add one sentence of body text to C and use
    `\clearpage` before the table (or `[p]`). Caption grammar: "Iteration 24 and 26 were" → "Iterations 24 and
    26 were". Contract stage 11 also asks for a notation *table*; Appendix D is a paragraph.

## Minor points

1. **Undefined acronyms.** LLM (title, §2, table headers) is never expanded; DLT (§4 Self-calibration); IoU (§4
   Analysis by synthesis, used in Table/Alg. 1 before that); MSSD/MSPD (§2 BOP); URDF/MJCF (§2). Expand at first
   use; add a citation for DLT (Hartley & Zisserman).
2. **Terms used before definition.** "blob" (intro finding (iv), §4 One call) is defined in §4 Detection; "phantom"
   used in §4 One call, defined in §4 Analysis by synthesis; "the bootstrap" (§7 Reasoning effort) is defined only
   inside the verbatim prompt; "record configuration" (Fig. 1 caption, p. 2) is defined in §3 (p. 4).
3. **room / scene.** Title and abstract say "scene reconstruction", "$0.032 per scene", "time per scene"; tables and
   §5 say "per room". Use "room" for the benchmark unit everywhere and "scene" only for the general concept.
4. **feeds / photographs / images / views / JPEGs / renders** all denote the two inputs (Fig. 1 caption alone uses
   "feeds"; abstract "photographs"; §3 "JPEG"; §4 "feed"). Pick "images" (and "views" for the geometric sense).
5. **sandbox / code-interpreter container / code-interpreter session / persistent kernel / Python sandbox.** Pick
   "sandbox" in prose, "code-interpreter session" only where the price is named.
6. **capacity axis / capacity ladder / capacity record / capacity rule** (§3, §5, §6, Fig. 2). Two terms at most.
7. **Number precision and units.**
   - Tokens: "6.3k" and "6k" in adjacent abstract sentences; "6,274" (§5, mean over both runs) while the range
     "5.5–6.8k" and Table 1 are run 2 only (run-2 mean is 6,200). State the run for each.
   - Time: "22 s" (abstract, intro), "22.3 s" (§5), "roughly 22 s" (§5). Table 1's "s" column is run 2 (mean
     23.2) but the caption says only tokens are "for run 2" — say time is too, and title the column "Time (s)".
   - Requests: "about 450 requests" (§8) vs "454 room solves" (§7).
   - Costs: "$0.032", "$0.03" (sandbox, §3), "$0.030" (§5), "three cents" (title, conclusion). Use $0.030 for the
     session and $0.032 for the total everywhere; "three cents" only in the title.
   - Fig. 1 caption "0.07" vs "0.071" elsewhere.
   - Spelled-out vs numeral counts: "two to twelve" (§1), "at most twelve" (§9), "eleven hours" (§7) vs "2–5 per
     room", "n ≤ 12", "ten rooms". Use numerals for object counts and hours.
8. **Table headers and captions.**
   - Table 2: run names are file names ("capacity-6-b", "-confirm"); label them "run 1 / run 2 (final helper)" and
     put the file name in the caption. "Exact" → "Exact (of 10)" in Tables 2, 3.
   - Table 3: header "LLM + tools mean (two-run)" is wrong for row 6 (single `-b` run, as the caption admits) and
     for row 10 (only `capacity-10`, no confirmation). Header: "VLM + helper mean"; footnote which rows are single
     runs.
   - Table 4: the "Difference" column reads "identical" ten times; drop it and state identity in the caption. The
     "mean" row puts a total (38) in the Objects column in Tables 1, 4, 5 — label the row "mean / total" or blank
     that cell.
   - Table 5: caption lacks the protocol (which helper commit, same scorer, offline on two vCPUs); "7/10 exact"
     sits in the "Remaining error" column.
   - Table 1: which run the "s" column reports (see 7).
   - Figure 2: y-axis "Mean score" without range; add "(0–100)" as in Fig. 3. Caption "The two coincide within run
     noise" — run noise is reported as zero at the record; say "differ by at most 0.9 points".
9. **Contract — math level (b) asks for the complexity of the labelling enumeration.** §4 says only "a small set of
   consistent labellings". State the number of labellings tried per hexagon (and per pentagon) and the total
   random-start budget.
10. **Contract — "numbers always with protocol".** Abstract and intro finding (i) give 99.5 without "mean of two
    runs"; intro (ii) gives 90.0 without saying it is a single medium-effort run. Add "(mean over 10 rooms × 2
    runs)" once in the abstract and once in the intro.
11. **First person / tense.** "This paper asks a narrow question" (§1) — contract is first person plural ("We
    ask"). "The 26 tuning iterations were carried out ... by an AI coding agent", "Two offline attempts were
    reverted" (§7) are agentless passives; "the system reaches" (abstract), "The 38 objects are all matched" (§5)
    are present tense for a past run. Small, but the contract names these.
12. **Hedges and vagueness.** "effectively closed" (§5); "roughly 22 s" (§5) next to "22.3 s"; "about 450" (§8);
    "in the runs we have" (§8); "gives a hint" (§6); "sometimes answers without running code" (§10) — either
    give the count from the repository or delete.
13. **Intro claim without our own evidence.** "Vision–language models (VLMs) cannot answer this on their own"
    (§1 para 2) is stated as fact on others' benchmarks, while the paper's own VLM-only baseline is unrun (§10 (ii)).
    Add "on published benchmarks" and one clause saying we did not run that baseline here (the reader otherwise
    expects it in §5).
14. **§7 first paragraph.** "The 48 result files ... Figure 3 plots them" — Figure 3 is on the tuning-iteration
    axis and cannot show the six capacity runs; Table 6 lists 38 benchmark rows. Say how many of the 48 files are
    benchmark runs, and that Figure 3 plots those.
15. **§4 "One call".** "teed into a transcript file" — jargon; "copied to". "the client polls" adds nothing for
    the claims.
16. **Bibliography.** Ref. [39] author list begins "NVIDIA, :, Niket Agarwal" (a stray ":" author); ref. [1] has
    "Mojtaba, Komeili" split across two authors. `refs.bib` carries 38 entries never cited (bigverdi2024perception
    ... zhou2023solving); harmless with natbib but the rubric says no orphans — prune before submission.
17. **Section 6 title vs table labels**: "Pipeline alone versus model plus pipeline" vs "LLM + tools" (see Major 7).
18. **Algorithm 1** uses "3 passes" (numeral) while prose uses "three"; line 4 wraps at "apparent / size" — shorten
    to "by ray gap and size".
19. **Equation (1)** — `#extra` is defined in prose only after the equation; define `#extra` (number of unmatched
    predictions) in the sentence before.
20. **Appendix A** lists a 68-line prompt at `\scriptsize` across two pages; fine, but note that it keeps British
    spelling verbatim (Major 1).

## Ten sentences to cut or shorten

1. Abstract: "Robot software wants an explicit description of the scene it is acting in—which objects are where,
   how big, how oriented—and the learned models that provide such descriptions are expensive to train and to run."
   → "Robots need an explicit description of the scene they act in; the learned models that provide one are
   expensive to train and run."
2. Abstract: "and we state precisely what the benchmark does and does not show." → delete.
3. §1 para 3: "A scorer that is invariant to the room's 48 symmetries and to each cube's 24 rotational symmetries
   compares the list with the ground truth." → delete (said in §3 Score).
4. §1 para 5: "the resulting scene is a digital twin whose dynamics are supplied by a physics engine, so it
   complements rather than replaces predictive world models [7, 12, 43]." → fold into the previous clause: "… in
   the state-estimation sense [7, 12, 43], not the latent-dynamics sense [19, 21]."
5. §2 VLM agents, last sentence: "We claim none of the ingredients; we claim their closed-loop combination, its
   measured accuracy–cost–latency frontier, and the finding about where the accuracy comes from." → move to §1
   contributions; delete here.
6. §5 Capacity, last sentence (mechanism of a missing object) → delete; §8 has it.
7. §6 para 2: "This is the paper's central honesty point and we state it plainly:" → delete the preamble; keep the
   italic claim as the paragraph's first sentence.
8. §6 para 2: "The capacity ladder gives a hint: at eight and ten objects the model-in-the-loop runs are again
   identical room for room to the pipeline ("the model copies the pipeline", in the benchmark log), so the model
   did not split the merged blobs either." → "At eight and ten objects the VLM + helper runs are also identical to
   the helper alone, room for room (Table 3)."
9. §7 Run-to-run variance: "which is why a second confirming run is cheap insurance early in tuning and a formality
   at the end." → delete.
10. Conclusion: "We think the negative half of that sentence is as useful as the positive half: for explicit scene
    state on structured scenes, the cheapest world model without training is a good tool library and a model that
    knows when to call it once." → see Major 6; one clause, no "cheapest".

## Tone: hype and self-congratulation

- §6 "This is the paper's central honesty point and we state it plainly" — announcing honesty is not honesty; state
  the fact.
- Abstract "we state precisely what the benchmark does and does not show" — same.
- Conclusion "We think the negative half of that sentence is as useful as the positive half" and "the cheapest world
  model without training" — editorial, and reuses the wording 05-decisions rejected.
- §7 "The lesson generalises" — from ten rooms, one model, one provider; say "on this task".
- §2 "unusually, reports per-sample cost" — acceptable, but "unusually" is a judgment; "one of few to report".
- Title "for Three Cents" — defensible as a hook, but §9 concedes the three cents are "a pricing decision, not a
  property of the method"; consider "for a Few Cents" or keep and make sure the abstract says "at list prices on the
  day of the runs".

## Length

Main text (title page through Conclusion + Reproducibility/Disclosure) ends on page 10; references pp. 10–13;
appendices pp. 14–16. Main text ≈ 9.7 pages: within the 9–11 page target. Abstract 288 words: over. Introduction
1.14 pages including Figure 1: within 1.2 but see Major 3.

## Verdict: minor revision

The one change that matters most: fix the two prose-vs-table contradictions (Figure 1 "cube" for a sphere; §6's
miscount of the held-out errors) and then impose one vocabulary — *helper alone* vs *VLM + helper* — across every
section title, table header and figure legend. After that, the mechanical pass: American spelling (13 distinct
words), abstract to ≤ 200 words, and the Figure 3 legend/annotation collision.

## Response (author)

1. American spelling applied throughout the main text (center, minimize, labeling, initialization, gray, …); Appendix A notes the prompt keeps the repository's British spelling.
2. Abstract cut to 202 words (from 288); one token figure.
3. Introduction reordered: findings paragraph second, system paragraph third; headline numbers and the zero-contribution finding are on page 1.
4–5. Both factual mismatches fixed (red cube; three orientations and three centers).
6. Conclusion rewritten without "cheapest"; the self-congratulatory sentence removed.
7. Terminology fixed on first use in §1 (helper / pipeline / VLM; conditions *helper alone* and *VLM + helper*) and used verbatim in §6's title, all table headers, figure legends.
8. The four errors are narrated once (§8) with the iteration-24 diagnosis; §5 points to the table; §7 Negative results shortened.
9. Helper-alone capacity data moved into §6; the mechanism sentence removed from §5; the "cost records closed" sentence moved to §7; §6 para 2 split into "Capacity rooms and where the model intervened" and "The model's contribution over the tuning campaign".
10. Multi-claim paragraphs split: §5 Cost / Latency; §3 Sets / Record rule and accounting; §6 as above; the moderation sentence moved to §3.
11. Figure 3: legend moved below all panels, open markers for confirmation runs (stated in caption), annotation moved right; fourth panel added; iteration numbering stated once in §7.
12. Appendix C has body text and the table is `[p]`; Appendix D is a table.
Minor: acronyms expanded (LLM, VLM, DLT, IoU, MSSD/MSPD, robot description files instead of URDF/MJCF); blob and phantom defined at first use; "room" for the benchmark unit; "images"/"views"; "sandbox" with "code-interpreter session" only for the price; numbers unified (22.3 s two-run mean, 23.4 s run 2; $0.030 / $0.032; 454 room solves); table headers fixed (Exact (of 10), Time (s), VLM + helper, single runs marked, mean/total rows); Fig. 2 axis label and caption fixed; the labeling-enumeration count (24 / 144) stated.
