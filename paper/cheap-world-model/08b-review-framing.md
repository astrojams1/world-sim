# Framing review — cheap-world-model — 2026-09-06

Reviewed: `main.tex` as of 2026-09-06 00:43:03 UTC (md5 `97e0a7057f895d771f7e9854f9471ef5`), all files in
`tables/`, and the thesis in `05-decisions.md` ("Thesis (revised 2026-09-06 ...)"). Rubric A items 1, 6, 12 and
rubric B item 11 only. The file changed once while I was reading it; three things I had noted against the 00:40
version were already fixed in the 00:43 version (Table 1 caption "Removing the model...", the Latency paragraph's
`Section~\ref{sec:ablation}`, and the abstract's "26 tuning iterations, each of which turned one of its
interventions into deterministic code"). Those are not listed below.

## Summary (3 sentences)

The reorder has done its job: title, abstract sentence 3, the introduction's statement of the result, the section
order (helper in Sections 4–5, VLM in Section 6, trajectory in Section 7) and the conclusion's first sentence all
make the deterministic helper the actor of the accuracy result, and every sentence that names the VLM as actor is
explicitly about the second (negative) result — rubric A12 and B11 pass. Two claims still outrun the tables: the
abstract quotes 95.9 for eight objects in a clause that reads as a fresh-room number when the fresh-room number is
89.6 (Table `fresh`), and the thesis's causal clause "because every intervention it made was turned into
deterministic code" (also abstract and conclusion) is contradicted by Table `interventions` and supported by no
table. The rest is stale plumbing from the reorder — one wrong cross-reference in Limitations, "final
configuration" used four times before it is defined, the primary results table still leading with the VLM + helper
column, and two numbers in the model-contribution narrative ("within a point of zero by iteration 7", "on every
room") that Table `floor` does not support as stated.

## Points

### A. Sentences that make the VLM / sandbox / one call / "world model" the actor (task item 1)

1. **Title, second half** — "How a Cheap Vision LLM Tuned Itself Out of the Loop"; **Introduction ¶2, last
   sentence but one** — "the 26-iteration trajectory (...) is the record of a model tuning itself out of the loop".
   Problem: the only agentive verb in the title, and the trajectory's summary sentence, give the VLM an action it did
   not perform. Section 7 ¶1 says the campaign "was carried out ... by an AI coding agent following a written
   procedure", and the Disclosure names that agent as Claude; `gpt-5-mini` changed neither prompt nor helper. This is
   not an attribution of the accuracy result to the VLM (so A6/A12 pass), but it is a factual misattribution of the
   tuning, and a hostile reader will use it. Severity: minor. Fix: title "...: How a Cheap Vision LLM Was Tuned Out of
   the Loop" (127 characters); intro "...is the record of a model being tuned out of the loop".

2. **Abstract, sentence 1** — "We ask whether the complete explicit state of a scene ... can be recovered from two
   uncalibrated images with no training, and what a cheap vision--language model (VLM) adds when placed in the loop."
   Assessment: acceptable. It has no actor (passive "can be recovered") and the VLM appears only as the thing whose
   *addition* is measured; the helper becomes the grammatical subject in sentence 3. B11 wants the same component in
   the first sentence; if the author wants it airtight: "We ask whether a deterministic program with no learned
   component can recover the complete explicit state of a scene ... from two uncalibrated images, and what a cheap
   vision–language model (VLM) adds when placed around it."

3. **Abstract, sentence 5** — "The system was built around \texttt{gpt-5-mini} with a Python sandbox, and the model's
   measured contribution is the second result: ..." Assessment: acceptable — explicitly labelled as the second result
   and about the VLM finding.

4. **Introduction ¶3** — "\ws{} ... hands them, the unit-cube statement, the generator's object vocabulary and a
   sandbox containing the helper \helper{} to the model in a single API call. Nothing else is passed. The model
   returns a JSON list of objects, which a scorer ... compares with the truth. The same helper, run offline on the
   same two images with no model, prints the same list." Assessment: acceptable. Three sentences describe the
   benchmark from the VLM system's side, but the fourth attributes the answer to the helper. It would read more
   consistently with the new subject if the offline path came first ("The helper, run offline on the two images,
   prints a JSON list of objects ...; the deployed system hands the same images and the helper to the model in a
   single API call and the model returns the same list"), but this is a preference, not a fault.

5. **Figure 1 caption** — "The two images the system receives for benchmark room 101 ... The final configuration
   scores this room 99.3/100; its one error is the 0.15 red cube's center 0.071 units off". Problem: in the paper's
   first figure the receiver and the scorer are "the system"/"the final configuration", i.e. the VLM + helper, and
   "final configuration" is undefined at this point (see point 14). The helper alone scores the same (Table 1), so
   the number is right but credited to the advertised component. Severity: minor. Fix: "The two images the helper
   receives for benchmark room 101 ... The helper scores this room 99.3/100 (Table 1); its one error is ..."

6. **Section headings** — "The helper, and the model around it"; "Results: the helper alone"; "The VLM in the loop";
   "How the frontier moved". Assessment: all acceptable; the heading order and wording follow the credited component.

7. **Section 6, ¶"The model's contribution over the tuning campaign"** — "What remains of the model in the final
   configuration is the harness: one API call that needs no GPU, no server-side Python environment and no per-scene
   engineering." Problem: two of the three virtues belong to the helper, not the call — the helper alone also needs
   no GPU and no per-scene engineering (Section 5: "seconds of CPU"). As written the sentence re-sells the VLM harness
   with the helper's properties. Severity: minor. Fix: "What remains of the model in the final configuration is the
   harness: one hosted call in place of a local Python process."

8. **Introduction ¶4 (Terminology)** — "Where we say ``world model'' we mean only the state-estimation sense---an
   explicit, simulator-ready description of the objects in a scene---not the learned latent-dynamics sense ..."
   Problem: after the retitle the paper never calls its own output a world model (the term's other occurrences are
   the motivation in ¶1, the related-work heading, and Limitations' "any world model in the predictive sense has to
   be built on top of it"). The disclaimer now defends a usage the paper no longer has and reads as a leftover of
   the old subject. Severity: minor. Fix: "We do not call the output a world model: in the dominant sense
   \citep{ha2018world,hafner2023mastering} that term means a learned predictive model; our output is the explicit
   state a simulator would need, i.e. a digital twin \citep{...}, which complements rather than replaces predictive
   world models \citep{wang2026world,chen2026definition,ding2024understanding}."

9. **Conclusion, sentence 1** — "a deterministic, self-calibrating analysis-by-synthesis helper with no learned
   component recovers the complete explicit state of the scene at 99.5/100 ... and 95.3 on 100 rooms it never saw".
   Assessment: acceptable; helper is subject; numbers in Tables 1 and `fresh`. **Sentence 2** — "The cheap VLM the
   system was built around was worth 14 points ..." acceptable as the VLM finding (but see point 12 for the
   mechanism clause and point 17 for "14").

10. **Limitations** — "``training-free'' for the deployed system means no learned component beyond the hosted VLM."
    Assessment: acceptable. "Cost figures ... the sandbox session that dominates them is a pricing decision, not a
    property of the method" — acceptable; correctly separates the call from the method.

### B. Thesis and abstract against the tables (task item 3)

11. **Abstract, sentence 4** — "Run alone, it scores 99.5/100 on the ten benchmark rooms (six exact), 95.3 (95\,\% CI
    93.4--96.9) on 100 fresh rooms the tuning never saw, and 95.9 with eight objects per room, in seconds of CPU."
    Problem: 99.5/six exact (Table 1) and 95.3 [93.4, 96.9] (Table `fresh`) check out, but 95.9 is the helper-alone
    mean on the *tuned* seeds 101–110 rendered with eight objects (Table `capacity_offline`). Placed in a list after
    "100 fresh rooms the tuning never saw", it reads as a fresh-room number; the fresh eight-object number is 89.6
    (Table `fresh`, row "1001--1030, 8 obj."). The introduction quotes 89.6 in the parallel sentence, and Section 5
    says of the fresh numbers "these are the numbers to quote for the helper's accuracy" — so the abstract contradicts
    both the introduction and the paper's own rule. Severity: **major** (rubric A1: an abstract number whose claim,
    as phrased, is not what the table shows). Fix: "Run alone, it scores 99.5/100 on the ten benchmark rooms (six
    exact), 95.3 (95\,\% CI 93.4--96.9) on 100 fresh rooms the tuning never saw, and 89.6 on 30 fresh rooms with eight
    objects (95.9 on the tuned rooms at that count), in seconds of CPU."

12. **Thesis (05-decisions.md), final clause** — "the cheap vision LLM that was placed around it to orchestrate it was
    worth +13.9 points before tuning and exactly zero after, because every intervention it made was turned into
    deterministic code."; **Abstract, sentence 5** — "exactly zero from the fifteenth of 26 tuning iterations, as each
    of its interventions was turned into deterministic code"; **Conclusion** — "each of its interventions became
    deterministic code". Problem: (a) no table or figure enumerates the model's interventions or maps them to
    iterations; the support is the narrative in Section 7 ¶"Work moved from the model to the tools" and the "Change
    tested" column of Table `history` (iterations 7, 16, 17, 18). (b) Table `interventions` shows interventions that
    were *not* turned into code: on the capacity rooms the model still splits or deletes objects (+4.2, −9.4), and the
    one attempt to code that class (iteration 26) was reverted (Section 7 ¶"Negative results"). "Every"/"each" is
    therefore contradicted by the paper's own table; the defensible statement is about classes of intervention on the
    default benchmark rooms. Severity: **major** for the thesis (it is the causal "because" of the second result) —
    the fix is a scope qualifier, not a re-choice of thesis. Fix (thesis): "...was worth +13.9 points before tuning and
    exactly zero on the benchmark rooms after, because the classes of intervention it made on those rooms (adding
    objects hidden in shared blobs, removing phantoms, shape verdicts) were moved into the helper at iterations 7 and
    16--18." Fix (abstract): "...and exactly zero from the fifteenth of 26 tuning iterations, once the kinds of
    intervention it made had been moved into the helper; where it still intervened it helped once and hurt once."
    Fix (conclusion): "...the kinds of intervention it made became deterministic code, and by the end of 26 iterations
    it ran one cell and copied the printout."

13. **Thesis, "exactly zero after"** — Problem: true for seeds 101–110 (Table `floor`, iterations 15–25 all +0.0) but
    not for all post-tuning runs: Table `interventions` records +4.2 and −9.4 on capacity rooms with the final prompt
    and released helper. The abstract carries the qualifier ("where it still intervened it helped once and hurt
    once"); the thesis does not. Severity: minor. Fix: as in point 12 ("exactly zero on the benchmark rooms after,
    and of both signs on the seven capacity room-runs where it still intervened").

14. **Thesis, "training-free"; title, "Without Training"** — Problem: Limitations states that the helper "does,
    however, contain constants fitted on labeled generator output---the three shading thresholds (midpoints between
    sphere and cube medians over 130 blobs) and the pairing threshold (a percentile of correct pairs' ray gaps)---and
    the repository does not record which seeds those blobs came from". The abstract's "no learned component" is the
    defensible phrase; "training-free" in the thesis and "Without Training" in the title are the phrases the
    Limitations paragraph undercuts. Severity: minor (disclosed; outside my four items except as thesis-vs-evidence).
    Fix: thesis "A deterministic analysis-by-synthesis pipeline with no learned component ..."; consider the same
    substitution in the title if length allows.

15. **Abstract, remaining sentences** — sentence 5's "+13.9" (Table `floor`, iteration 0), "helped once and hurt
    once" (Table `interventions`), sentence 6's "\$0.032 and 22\,s per room" (Table `record` caption and rows; Table
    `history` iteration 23: 21/23 s, 0.032) and "\$0.030 of it the sandbox" (Section 3 accounting; a stated price, not
    a measurement — acceptable) all check out. Sentence 2 and sentence 7 make no numeric claims.

16. **Thesis, remaining numbers** — 99.5 (Table 1), 95.3 (Table `fresh`), "seconds of CPU" (Table `capacity_offline`
    s/room 8–14; Section 5 text 8–21 s) check out.

### C. Order, cross-references and table roles after the reorder (task item 2)

17. **Limitations ¶, sentence 4** — "The test set of Section~\ref{sec:ablation} is our answer to that". Problem: the
    test set is introduced in Section 3 and reported in Section 5 (`sec:results`); `sec:ablation` is now Section 6,
    "The VLM in the loop", which never runs the test set. Stale reference from before the reorder (the same slip in
    the Latency paragraph was fixed at 00:43; this one was not). Severity: minor (but a wrong pointer in the paragraph
    that defends the training-free claim). Fix: "The test set of Section~\ref{sec:results} is our answer to that".

18. **Table 1 (`tab:ablation`), column order and label** — columns run "VLM + helper (run 1 / run 2) | Helper alone,
    same helper | Helper alone, released helper". Problem: the caption was retitled "Helper alone on seeds 101--110,
    with the deployed VLM + helper runs ... for comparison", but the table body still leads with the VLM + helper
    column, and the label is still `tab:ablation` — the table is laid out as an ablation of the VLM system rather
    than as the primary result of the helper. The main text ("The table's VLM + helper column anticipates
    Section~\ref{sec:ablation}") is fine. Severity: minor. Fix: in `scripts/analyze_bench.py`, emit the columns as
    "Helper alone, same helper | Helper alone, released helper | VLM + helper (run 1 / run 2)"; optionally rename the
    label to `tab:benchmark` (the label is invisible to readers, so this is housekeeping).

19. **Forward references that are acceptable as written** (listed so the author does not chase them): Section 5
    ¶"Benchmark rooms" → "anticipates Section~\ref{sec:ablation}" (explicit); Table 1 caption → Section 6 (explicit
    "for comparison"); Table `capacity_offline` caption → "the VLM + helper means of Table~\ref{tab:capacity} for
    comparison"; Figure `capacity` caption → Table `interventions`; Section 6 ¶"Final configuration" → "iteration 23 of
    Section~\ref{sec:trajectory}"; Section 6 last ¶ → "the last panel of Figure~\ref{fig:frontier}" (the figure sits
    in Section 7, so it is referenced before it appears — fine). Backward references that now point the right way:
    Section 6 ¶"Cost" ("Section~\ref{sec:results} showed that the same state is obtained with neither"), ¶"Latency"
    ("the shared two-vCPU machine of Section~\ref{sec:results}"), ¶"Capacity with the model" ("(Section~\ref{sec:results})").

20. **Abstract / introduction vs section order** — consistent: abstract sentences 3–4 (helper) → sentence 5 (VLM);
    introduction ¶2 "The first ... (Section~\ref{sec:results}). The second half ... (Section~\ref{sec:ablation}) ...
    (Section~\ref{sec:trajectory})"; contributions list in the same order. No point to raise.

21. **05-decisions.md, "Consequences for the draft"** — "Section 5 reports helper-alone results (benchmark,
    development, test, capacity) before the VLM-in-the-loop results (record run, cost, latency, interventions)."
    Problem: in the paper the VLM-in-the-loop results are Section 6, not the second half of Section 5. Harmless
    drift in the contract document. Severity: minor. Fix: "Section 5 reports helper-alone results ...; Section 6 the
    VLM-in-the-loop results ...".

### D. Contradictions and definition order introduced by the reorder (task item 4)

22. **"final configuration" used before it is defined** — Figure 1 caption ("The final configuration scores this room
    99.3/100"), Section 4 last sentence ("In the final configuration every benchmark room-run finishes in one cell"),
    Section 5 ¶1 ("the one that produced the final VLM + helper configuration", "the final configuration's helper"),
    Section 5 ¶"Benchmark rooms" ("in the final configuration the model runs one cell"). The term is defined only in
    Section 6 ¶"Final configuration" ("iteration 23 ...; helper at commit 3744bdf"). Before the reorder the
    definition preceded the offline results; now it follows them. Severity: minor. Fix: add to the Terminology
    paragraph in the introduction: "the \emph{final configuration} is tuning iteration 23---the prompt of
    Appendix~\ref{app:prompt} and helper commit \texttt{3744bdf}---i.e. the deployed VLM + helper."

23. **"phantoms" and "shared blobs" used before definition** — Introduction ¶2: "added objects hidden in shared blobs
    and removed phantoms". "Blob" is defined in Section 4 ¶"Detection, matching, hypothesis"; "phantoms" in Section 4
    ¶"Analysis by synthesis" ("objects whose footprint falls on too few real pixels of their color"). Severity: minor.
    Fix: "added objects hidden behind others in one view and removed spurious (`phantom') objects".

24. **Introduction ¶2 and Section 6 ¶"The model's contribution ..."** — both: "by the seventh iteration the model's
    contribution was within a point of zero, [and] from the fifteenth it was exactly zero on every room". Problem: (a)
    Table `floor` gives −0.3 at iteration 7 but −2.1 at iteration 14, so "within a point of zero" did not hold from
    iteration 7 onward; (b) Table `floor` reports means, not rooms, so "exactly zero on every room" is evidenced only
    at the final configuration (Table 1 shows identical per-room scores for iteration 23). Severity: minor. Fix: "the
    contribution was within a point of zero at iteration 7 and at every recorded iteration but one (−2.1 at 14); from
    iteration 15 the two means are equal at every recorded iteration, and at the final configuration the per-room
    scores are identical (Table~\ref{tab:ablation})".

25. **Introduction ¶4 (Contributions)** — "the tuning trajectory with the helper-alone floor at every iteration".
    Problem: Table `floor` has 15 of the 27 numbered iterations, and its caption says "at each tuning iteration where
    the log recorded it"; Section 6 says "at most iterations". The contribution bullet claims more than the table.
    Severity: minor. Fix: "the tuning trajectory with the helper-alone floor at 15 of its 27 iterations".

26. **Duplicated narrative** — Introduction ¶2 (from "At the first iteration the model was worth +13.9 points" to
    "helped once and hurt once") and Section 6 ¶"The model's contribution over the tuning campaign" (from "At the
    baseline helper the model was worth +13.9 points" to "exactly zero on every room") say the same four things in
    the same order, and the abstract and conclusion say them a third and fourth time. A summary in the introduction
    is expected; the Section 6 paragraph should add what the introduction cannot (which iterations moved which class
    of intervention, with the Table `history` rows), or it is a fourth copy. Severity: minor. Fix: in Section 6,
    replace "Each such intervention was treated as a signal that the helper should do it deterministically; by
    iteration 7 ..." with the per-iteration mapping now in Section 7 ¶"Work moved from the model to the tools"
    ("iterations 7, 16, 17 and 18 moved the shape decision, the size--rotation coupling, the phantom test and
    occlusion handling into the helper"), and leave Section 7 with the cost/time levers.

27. **Numbers that appear in text but in no table or figure** (rubric A1 applied to the body; the abstract is clean
    apart from point 11): Section 5 ¶1 "210: 90.9 with the final configuration's helper" (Table `heldout` shows only
    the released helper's 98.8); Section 5 ¶"Development and test sets" "room 1087, 40.7"; Section 6 ¶"Final
    configuration" "115 and 134\,s for ten rooms"; Section 6 ¶"Capacity with the model" "one room (107, at 83.6)";
    Section 7 ¶"Work moved ..." "50.8 to 62.4\,s in two-run means" — Table `history` gives 58/44 s (mean 51.0) for
    iteration 15 and 55/65 s (mean 60.0) for iteration 16, so 62.4 is not derivable from the table and the "23\,\%"
    is 18\,\% by the table's numbers; Section 7 ¶"Reasoning effort" "mean 95.8 for both" (eight-room subset, not in
    Table `history`). Severity: minor. Fix: either add these to the relevant table (a "released vs same helper" column
    in Table `heldout`; a per-room capacity table; the eight-room subset means) or state where they come from ("from
    the result files") and make 62.4 consistent with Table `history` (use 60.0 and 18\,\%, or footnote that the
    re-run's time is substituted).

28. **Precision drift for the same number** — Introduction ¶2: "over 22 code cells" and, four sentences later, "code
    cells per room 21.7 to 1.0" (Table `history`: 21.7); Conclusion: "worth 14 points" vs "+13.9" in abstract, Table
    `floor`, Sections 1 and 6. Severity: minor. Fix: use 21.7 and +13.9 throughout.

29. **Sandbox vs laptop timing** — Section 5 ¶1: "in the hosted sandbox the same computation takes 3--10\,s, and on a
    laptop about 5\,s"; Section 6 ¶"Latency": "the helper's computation takes 3--10\,s in the sandbox (it runs
    2--3$\times$ slower there than on a laptop ...)". Problem: a 3–10 s sandbox range and a 5 s laptop time are not
    "2–3× slower"; the two sentences cannot both be right. Not caused by the reorder, but it is an internal
    contradiction between the helper section and the VLM section. Severity: minor. Fix: give one pair of numbers
    (e.g. "3--10\,s in the sandbox against 2--4\,s on a laptop") in Section 5 and refer to it from Section 6.

## Verdict: minor revision

The subject is now right (rubric A12 / B11 pass): the helper is the actor of the accuracy result in the title's
first half, abstract sentences 3–4, the introduction's statement of the result, the section order and the
conclusion; every sentence that makes the VLM the actor is explicitly about the second result. Two fixes matter
most and are each one sentence: replace the abstract's "95.9 with eight objects per room" with the fresh-room 89.6
(point 11), and scope the thesis/abstract/conclusion clause "every/each intervention was turned into deterministic
code" to the classes of intervention on the benchmark rooms (point 12). Then the stale `sec:ablation` reference in
Limitations (17), the definition of "final configuration" (22), and the Table 1 column order (18).

## Response (author, 2026-09-06)

All points acted on except where noted.

- **1** fixed: title "How a Cheap Vision LLM Was Tuned Out of the Loop"; introduction "a model being tuned out of the loop".
- **2** fixed as suggested (deterministic program is the subject of the abstract's first sentence).
- **3, 6, 9, 10, 15, 16, 19, 20** acceptable — no change.
- **4** fixed: introduction ¶3 now gives the offline path first and the deployed call second.
- **5** fixed: Figure 1 caption credits the helper and points to Table `ablation`.
- **7** fixed: "one hosted call in place of a local Python process".
- **8** fixed: the terminology paragraph no longer defends a "world model" usage; it says why we do not use the term.
- **11 (major)** fixed: abstract quotes 89.6 on 30 fresh eight-object rooms, with 95.9 marked as the tuned-room number.
- **12 (major), 13** fixed: thesis (05-decisions.md), abstract and conclusion now say "the kinds of intervention it made" were moved into the helper, with the iterations named in the thesis and in Section 6; thesis scoped to the benchmark rooms with the capacity interventions stated.
- **14** fixed in the thesis ("no learned component"); the title keeps "Without Training" with the fitted constants disclosed in Limitations, as run 1's reviewer accepted.
- **17** fixed: Limitations points the test set at Section 5.
- **18** fixed: `scripts/analyze_bench.py` emits the helper-alone columns first; table regenerated. Label `tab:ablation` kept (invisible to readers; avoids touching every reference).
- **21** fixed in 05-decisions.md.
- **22** fixed: "final configuration" defined in the terminology paragraph.
- **23** fixed: "objects hidden behind others in one view", "spurious (`phantom') objects".
- **24** fixed in both places with the reviewer's wording (within a point of zero at iteration 7 and at every recorded iteration but one; equal means from iteration 15; identical per-room scores at the final configuration).
- **25** fixed: "at 15 of its 27 iterations".
- **26** fixed: Section 6's paragraph now carries the per-iteration mapping (2, 7, 16, 17, 18 with Table `history`); Section 7 keeps the cost/time levers.
- **27** partly: the 62.4 s figure now says it is the log's two-run mean with the re-run substituted; the other body numbers (210 with the same helper, room 1087, wall clock, room 107, eight-room effort means) remain as in run 1, where they were accepted with their sources named in the text — deferred.
- **28** fixed: 21.7 cells per room and +13.9 everywhere.
- **29** fixed: one set of timings in Section 5 (sandbox 3–10 s, laptop 5.5 s from the log); Section 6 refers to it.

Abstract after the fixes: 214 words (contract 200; run 1 shipped 202). The extra words are the 89.6/95.9
qualification of point 11 and the scoping clause of point 12, both of which the review required.
