#!/usr/bin/env python3
"""Re-analysis of bench/results/*.json for the paper: tables (LaTeX) and figures (PDF).

  python3 scripts/analyze_bench.py            # run from paper/cheap-world-model

Writes tables/*.tex, figures/*.pdf and experiments/analysis.json (all numbers used in the text).
Every number in the paper comes from here or from experiments/offline-*.json; nothing is typed by hand.
"""
import glob
import json
import os
import re
import statistics
from decimal import Decimal, ROUND_HALF_UP


def r1(x):
    return str(Decimal(str(x)).quantize(Decimal('0.1'), rounding=ROUND_HALF_UP))
import subprocess

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
PAPER = os.path.normpath(os.path.join(HERE, ".."))
REPO = os.path.normpath(os.path.join(PAPER, "..", ".."))
RES = os.path.join(REPO, "bench", "results")
TAB = os.path.join(PAPER, "tables")
FIG = os.path.join(PAPER, "figures")
os.makedirs(TAB, exist_ok=True)
os.makedirs(FIG, exist_ok=True)

# Okabe-Ito subset, validated with the dataviz palette script (direct labels used as secondary encoding).
C = {"blue": "#0072B2", "orange": "#E69F00", "green": "#009E73", "pink": "#CC79A7", "grey": "#7f7f7f"}
plt.rcParams.update({"font.size": 8, "axes.spines.top": False, "axes.spines.right": False, "axes.grid": True,
                     "grid.color": "#e6e6e6", "grid.linewidth": 0.5, "axes.axisbelow": True, "pdf.fonttype": 42})

runs = {}
for f in glob.glob(os.path.join(RES, "*.json")):
    d = json.load(open(f))
    runs[d["summary"]["label"]] = d
A = {}  # analysis numbers for the text


def summ(label):
    return runs[label]["summary"]


def rows(label):
    return runs[label]["rows"]


# ---------------------------------------------------------------- history table (in BENCH.md order)
ORDER = ["iter0-baseline", "iter1-shape-check", "iter2-solve-all", "iter2-solve-all-confirm", "iter3-fast-helper",
         "iter3-fast-helper-confirm", "iter4-verbatim-output", "iter4-verbatim-output-confirm", "iter5-small-cube-margin",
         "iter5-small-cube-margin-confirm", "iter6-hard-stop", "iter7-shading-tiebreak", "iter7-shading-tiebreak-confirm",
         "iter8-pairing-size-term", "iter9-low-effort", "iter10-low-effort-robust", "iter11-low-effort-outlines",
         "iter12-low-effort-nolog-tee", "iter12-low-effort-nolog-tee-confirm", "iter13-low-effort-fast-fallback",
         "iter14-low-effort-pentagon", "iter14-low-effort-pentagon-confirm", "iter15-low-effort-fast-pose",
         "iter15-low-effort-fast-pose-confirm", "iter16-low-effort-size-rot-chroma", "iter16-low-effort-size-rot-chroma-confirm",
         "iter17-low-effort-final-banner", "iter17-low-effort-final-banner-confirm", "iter18-low-effort-occlusion",
         "iter18-low-effort-occlusion-confirm", "iter19-low-effort-one-cell", "iter20-low-effort-cheaper-search",
         "iter21-low-effort-lean-compute", "iter21-low-effort-lean-compute-confirm", "iter22-low-effort-short-notes",
         "iter22-low-effort-short-notes-confirm", "iter23-low-effort-compact-printout",
         "iter23-low-effort-compact-printout-confirm", "iter25-low-effort-shared-one-view"]
SHORT = {  # one-line hypothesis per iteration (from bench/BENCH.md), keyed by iteration number
    0: "baseline prompt + helper, medium effort", 1: "silhouette shape check in prompt; soft renders",
    2: "one-shot solve\\_all pipeline + finish()", 3: "per-object search on residuals; blob caps",
    4: "shape verdicts final; output JSON verbatim; 6-cell cap", 5: "grid-aligned wall margin; size-scaled cube margin",
    6: "FINAL ANSWER banner as hard stop", 7: "shading tie-break for sphere vs cube",
    8: "apparent-size term in blob pairing", 9: "same code, reasoning effort low",
    10: "truncation fallback; no help(ws); outline de-dup", 11: "candidate outlines (6/5-corner fallbacks)",
    12: "transcript tee moved into helper; count rule", 13: "capped outline fallback",
    14: "five-corner (pentagon) outline fit", 15: "batched pose fit; early stop; app default low",
    16: "size+rotation joint refine; chroma masks; overlap test", 17: "phantom test by footprint; stop on repeated issue",
    18: "occlusion-aware explain\\_unpaired; skip hidden views", 19: "solve\\_all prints the banner: one cell",
    20: "cheaper rotation/depth searches", 21: "no Powell polish; 150 starts; lean renderer",
    22: "two-sentence notes; skip poor labelings", 23: "compact printout",
    25: "blob shared in one view judged from the other"}
hist = []
for lab in ORDER:
    if lab not in runs:
        continue
    s = summ(lab)
    it = int(re.match(r"iter(\d+)", lab).group(1))
    cells = statistics.mean(r["codeRuns"] or 0 for r in rows(lab))
    hist.append({"label": lab, "iter": it, "confirm": lab.endswith("confirm"), "effort": s["effort"], "mean": s["meanScore"],
                 "exact": s["exactMatches"], "sec": s["meanSeconds"], "tok": s["meanTokens"], "cost": s["meanCostUsd"], "cells": cells})
with open(os.path.join(TAB, "history.tex"), "w") as f:
    f.write("\\begin{tabular}{@{}rlp{5.6cm}rrrrrr@{}}\n\\toprule\n")
    f.write("It. & Effort & Change tested & Mean & Exact & s/room & Tokens & \\$/room & Cells \\\\\n\\midrule\n")
    for h in hist:
        name = SHORT.get(h["iter"], "") if not h["confirm"] else "\\emph{confirmation run}"
        f.write(f"{h['iter']} & {h['effort']} & {name} & {h['mean']:.1f} & {h['exact']} & {h['sec']:.0f} & {h['tok']:,} & {h['cost']:.3f} & {h['cells']:.1f} \\\\\n")
    f.write("\\bottomrule\n\\end{tabular}\n")
A["history"] = hist

# ---------------------------------------------------------------- frontier figure (+ offline floor series)
FLOOR = json.load(open(os.path.join(PAPER, "experiments", "offline-floor-benchmd.json")))["rows"]
A["floor"] = FLOOR
fig, axes = plt.subplots(1, 4, figsize=(7.2, 2.1))
xs = [h["iter"] + (0.4 if h["confirm"] else 0) for h in hist]
for ax, key, lab in zip(axes[:3], ["mean", "sec", "tok"], ["Mean score (0\u2013100)", "Seconds per room", "Tokens per room"]):
    for eff, col, mk in (("medium", C["blue"], "o"), ("low", C["orange"], "s")):
        pts = [(x, h[key], h["confirm"]) for x, h in zip(xs, hist) if h["effort"] == eff]
        ax.plot([p[0] for p in pts], [p[1] for p in pts], "-", lw=1.0, color=col)
        ax.plot([p[0] for p in pts if not p[2]], [p[1] for p in pts if not p[2]], mk, ms=3.5, color=col, label=f"{eff} effort")
        ax.plot([p[0] for p in pts if p[2]], [p[1] for p in pts if p[2]], mk, ms=3.5, mfc="white", color=col, label=f"{eff}, confirmation run")
    ax.set_xlabel("Tuning iteration")
    ax.set_title(lab, fontsize=8, loc="left")
    ax.set_ylim(74, 101) if key == "mean" else ax.set_ylim(0, None)
axes[0].annotate("two empty\nanswers", xy=(9, 76.6), xytext=(13.5, 77.5), fontsize=6.5, va="center", arrowprops=dict(arrowstyle="-", lw=0.6, color=C["grey"]))
ax = axes[3]
fl = [r for r in FLOOR if r["offline_bench"] is not None]
ax.axhline(0, color=C["grey"], lw=0.6)
ax.plot([r["iter"] for r in fl], [r["api"] - r["offline_bench"] for r in fl], "D-", ms=3.5, lw=1.0, color=C["green"], label="VLM + helper minus helper alone")
ax.set_xlabel("Tuning iteration")
ax.set_title("VLM contribution (points)", fontsize=8, loc="left")
ax.set_ylim(-4, 16)
h, l = axes[0].get_legend_handles_labels()
fig.legend(h, l, loc="lower center", ncol=4, frameon=False, fontsize=6.5, bbox_to_anchor=(0.5, -0.02))
fig.tight_layout(rect=(0, 0.07, 1, 1))
fig.savefig(os.path.join(FIG, "frontier.pdf"), bbox_inches="tight")
plt.close(fig)
with open(os.path.join(TAB, "floor.tex"), "w") as f:
    f.write("\\begin{tabular}{@{}rrrrr@{}}\n\\toprule\nIteration & Helper alone, seeds 101--110 & Helper alone, seeds 201--210 & VLM + helper, seeds 101--110 & VLM contribution \\\\\n\\midrule\n")
    for r in FLOOR:
        dev = "--" if r["offline_dev"] is None else f"{r['offline_dev']:.1f}"
        d = r['api'] - r['offline_bench']
        f.write(f"{r['iter']} & {r['offline_bench']:.1f} & {dev} & {r1(r['api'])}{'' if r['api_runs'] == 2 else '$^*$'} & {'+' if d >= 0 else '-'}{r1(abs(d))} \\\\\n")
    f.write("\\bottomrule\n\\end{tabular}\n")

# ---------------------------------------------------------------- record: per-room table with error details
REC = ["iter23-low-effort-compact-printout", "iter23-low-effort-compact-printout-confirm"]
inp = []
for lab in REC:
    for r in rows(lab):
        inp.append({"name": f"{lab}:{r['seed']}", "truth": r["truth"], "guess": r["guess"]})
json.dump(inp, open("/tmp/_score_in.json", "w"))
subprocess.run(["npx", "tsx", os.path.join(HERE, "score_rows.ts"), "/tmp/_score_in.json", "/tmp/_score_out.json"], cwd=REPO, check=True)
scored = {r["name"]: r for r in json.load(open("/tmp/_score_out.json"))}


def issues(det, truth_objs):
    out = []
    for d in det:
        t = truth_objs[d["truthId"] - 1]
        if not d["matched"]:
            out.append(f"missing {t['color']} {t['shape']}")
            continue
        if not d.get("shapeOk", True):
            out.append(f"shape ({t['shape']}→)")
        if not d.get("colorOk", True):
            out.append("color")
        if (d.get("sizeError") or 0) > 0.012:
            out.append(f"size {d['sizeError']:.3f}")
        if (d.get("positionError") or 0) > 0.03:
            out.append(f"pos {d['positionError']:.3f}")
        if d.get("orientationError") is not None and d["orientationError"] > 10:
            out.append(f"ori {d['orientationError']:.0f}°")
    return out


with open(os.path.join(TAB, "record_rooms.tex"), "w") as f:
    f.write("\\begin{tabular}{@{}rrrrrrl@{}}\n\\toprule\nRoom & Objects & Score (run 1) & Score (run 2) & Time (s) & Tokens & Remaining error \\\\\n\\midrule\n")
    per = []
    for r1, r2 in zip(rows(REC[0]), rows(REC[1])):
        seed = r1["seed"]
        d2 = scored[f"{REC[1]}:{seed}"]
        iss = issues(d2["details"], r2["truth"]) or ["—"]
        n = len(r2["truth"])
        f.write(f"{seed} & {n} & {r1['score']:.1f} & {r2['score']:.1f} & {r2['seconds']:.1f} & {r2['tokens']['total']:,} & {'; '.join(iss)} \\\\\n")
        per.append({"seed": seed, "n": n, "s1": r1["score"], "s2": r2["score"], "sec": r2["seconds"], "tok": r2["tokens"], "issues": iss, "cells": r2["codeRuns"]})
    f.write("\\bottomrule\n\\end{tabular}\n")
A["record_rooms"] = per
A["record"] = {"mean": statistics.mean([summ(l)["meanScore"] for l in REC]), "sec": statistics.mean([summ(l)["meanSeconds"] for l in REC]),
               "tok": statistics.mean([summ(l)["meanTokens"] for l in REC]), "cost": statistics.mean([summ(l)["meanCostUsd"] for l in REC]),
               "exact": [summ(l)["exactMatches"] for l in REC], "objects_total": sum(p["n"] for p in per),
               "wall_clock": [summ(l)["wallClockSeconds"] for l in REC]}
tok = [r["tokens"] for r in rows(REC[1])]
A["record_tokens"] = {k: statistics.mean(t[k] for t in tok) for k in ("input", "cached", "output", "reasoning", "total")}
A["record_seconds_range"] = [min(r["seconds"] for r in rows(REC[1])), max(r["seconds"] for r in rows(REC[1]))]

# ---------------------------------------------------------------- run-to-run variance from candidate/confirm pairs
pairs = [(l, l + "-confirm") for l in ORDER if l + "-confirm" in runs and l in runs]
diffs, mean_diffs = [], []
for a, b in pairs:
    ra = {r["seed"]: r["score"] for r in rows(a) if r["error"] is None}
    rb = {r["seed"]: r["score"] for r in rows(b) if r["error"] is None}
    diffs += [abs(ra[s] - rb[s]) for s in ra if s in rb]
    mean_diffs.append(abs(summ(a)["meanScore"] - summ(b)["meanScore"]))
A["variance"] = {"pairs": len(pairs), "room_abs_diff_median": statistics.median(diffs), "room_abs_diff_p90": sorted(diffs)[int(0.9 * len(diffs))],
                 "room_abs_diff_max": max(diffs), "rooms_identical_frac": sum(d == 0 for d in diffs) / len(diffs),
                 "mean_abs_diff_median": statistics.median(mean_diffs), "mean_abs_diff_max": max(mean_diffs)}
# at the record (one cell): identical?
rec_diffs = [abs(a["score"] - b["score"]) for a, b in zip(rows(REC[0]), rows(REC[1]))]
A["variance"]["record_pair_identical_rooms"] = sum(d == 0 for d in rec_diffs)
A["variance"]["record_pair_max_diff"] = max(rec_diffs)

# ---------------------------------------------------------------- effort ablation (iter 8 medium vs iter 9 low, same code)
A["effort"] = {l: {"mean": summ(l)["meanScore"], "sec": summ(l)["meanSeconds"], "tok": summ(l)["meanTokens"], "cells": statistics.mean(r["codeRuns"] or 0 for r in rows(l)),
                   "empty": sum(len(r["guess"]["objects"]) == 0 for r in rows(l))} for l in ("iter8-pairing-size-term", "iter9-low-effort")}
r8 = {r["seed"]: r["score"] for r in rows("iter8-pairing-size-term")}
r9 = {r["seed"]: r["score"] for r in rows("iter9-low-effort")}
nonempty = [s for s in r9 if len([x for x in rows("iter9-low-effort") if x["seed"] == s][0]["guess"]["objects"])]
A["effort"]["same8"] = {"rooms": sorted(nonempty), "low": statistics.mean(r9[s] for s in nonempty), "medium": statistics.mean(r8[s] for s in nonempty),
                        "identical_rooms": sum(r8[s] == r9[s] for s in nonempty)}

# ---------------------------------------------------------------- capacity table
CAP = [("capacity-6", 6), ("capacity-6-b", 6), ("capacity-8", 8), ("capacity-8-b", 8), ("capacity-8-confirm", 8), ("capacity-10", 10)]
with open(os.path.join(TAB, "capacity.tex"), "w") as f:
    f.write("\\begin{tabular}{@{}rlrrrrr@{}}\n\\toprule\nObjects & Run & Mean & Exact (of 10) & s/room & Tokens & \\$/room \\\\\n\\midrule\n")
    for lab, n in CAP:
        s = summ(lab)
        f.write(f"{n} & {lab} & {s['meanScore']:.1f} & {s['exactMatches']} & {s['meanSeconds']:.0f} & {s['meanTokens']:,} & {s['meanCostUsd']:.3f} \\\\\n")
    f.write("\\bottomrule\n\\end{tabular}\n")
A["capacity"] = {lab: {"n": n, "mean": summ(lab)["meanScore"], "sec": summ(lab)["meanSeconds"], "tok": summ(lab)["meanTokens"]} for lab, n in CAP}

# ---------------------------------------------------------------- totals
A["totals"] = {"files": len(runs), "rooms": sum(s["summary"]["rooms"] for s in runs.values()),
               "usd": round(sum(s["summary"]["totalCostUsd"] for s in runs.values()), 2),
               "tokens": sum(sum((r["tokens"] or {}).get("total", 0) for r in d["rows"]) for d in runs.values()),
               "first": min(s["summary"]["ranAt"] for s in runs.values()), "last": max(s["summary"]["ranAt"] for s in runs.values()),
               "api_errors": sum(s["summary"]["errors"] for s in runs.values()),
               "violations": sum(len(s["summary"]["violations"]) for s in runs.values())}
A["baseline"] = {"mean": summ("iter0-baseline")["meanScore"], "sec": summ("iter0-baseline")["meanSeconds"], "tok": summ("iter0-baseline")["meanTokens"],
                 "cost": summ("iter0-baseline")["meanCostUsd"], "cells": statistics.mean(r["codeRuns"] for r in rows("iter0-baseline")), "exact": summ("iter0-baseline")["exactMatches"]}

# ---------------------------------------------------------------- offline (pipeline alone) if present
for name in ("offline-default", "offline-capacity"):
    p = os.path.join(PAPER, "experiments", name + ".json")
    if not os.path.exists(p):
        continue
    subprocess.run(["npx", "tsx", os.path.join(HERE, "score_rows.ts"), p, p.replace(".json", "-scored.json")], cwd=REPO, check=True)
    sc = json.load(open(p.replace(".json", "-scored.json")))
    A[name] = [{"name": r["name"], "score": r["score"], "exact": r["exact"], "seconds": r["seconds"], "n": len(r["truth"]["objects"]) if isinstance(r["truth"], dict) else len(r["truth"]),
                "issues": issues(r["details"], (r["truth"]["objects"] if isinstance(r["truth"], dict) else r["truth"])), "error": r["error"]} for r in sc]

if "offline-default" in A:
    off = {r["name"]: r for r in A["offline-default"]}
    bench = [off[str(s)] for s in range(101, 111)]
    held = [off[str(s)] for s in range(201, 211)]
    A["offline_summary"] = {"bench_mean": statistics.mean(r["score"] for r in bench), "bench_exact": sum(r["exact"] for r in bench),
                            "held_mean": statistics.mean(r["score"] for r in held), "held_exact": sum(r["exact"] for r in held),
                            "sec_mean": statistics.mean(r["seconds"] for r in bench + held), "sec_max": max(r["seconds"] for r in bench + held)}
    with open(os.path.join(TAB, "llm_vs_pipeline.tex"), "w") as f:
        f.write("\\begin{tabular}{@{}rrrrl@{}}\n\\toprule\nRoom & Objects & LLM + tools (run 2) & Pipeline alone & Difference \\\\\n\\midrule\n")
        for p in per:
            o = off[str(p["seed"])]
            d = p["s2"] - o["score"]
            f.write(f"{p['seed']} & {p['n']} & {p['s2']:.1f} & {o['score']:.1f} & {'identical' if abs(d) < 0.05 else f'{d:+.1f}'} \\\\\n")
        f.write("\\midrule\n")
        f.write(f"mean & {A['record']['objects_total']} & {summ(REC[1])['meanScore']:.1f} & {A['offline_summary']['bench_mean']:.1f} & \\\\\n")
        f.write("\\bottomrule\n\\end{tabular}\n")
    with open(os.path.join(TAB, "heldout.tex"), "w") as f:
        f.write("\\begin{tabular}{@{}rrrl@{}}\n\\toprule\nRoom & Objects & Helper alone & Remaining error \\\\\n\\midrule\n")
        for r in held:
            f.write(f"{r['name']} & {r['n']} & {r['score']:.1f} & {'; '.join(r['issues']) or '—'} \\\\\n")
        f.write(f"\\midrule\nmean / total & {sum(r['n'] for r in held)} & {A['offline_summary']['held_mean']:.1f} & {A['offline_summary']['held_exact']} of 10 rooms exact \\\\\n")
        f.write("\\bottomrule\n\\end{tabular}\n")

if "offline-capacity" in A:
    by_n = {}
    for r in A["offline-capacity"]:
        n = int(r["name"].split("-o")[1])
        by_n.setdefault(n, []).append(r)
    A["offline_capacity_summary"] = {n: {"mean": statistics.mean(x["score"] for x in v), "exact": sum(x["exact"] for x in v), "sec": statistics.mean(x["seconds"] for x in v),
                                        "missing": sum(sum(i.startswith("missing") for i in x["issues"]) for x in v)} for n, v in sorted(by_n.items())}
    with open(os.path.join(TAB, "capacity_offline.tex"), "w") as f:
        f.write("\\begin{tabular}{@{}rrrrrr@{}}\n\\toprule\nObjects & Helper alone & Exact & Missing objects & s/room (offline) & VLM + helper \\\\\n\\midrule\n")
        llm = {6: statistics.mean([summ("capacity-6-b")["meanScore"]]), 8: statistics.mean([summ("capacity-8-b")["meanScore"], summ("capacity-8-confirm")["meanScore"]]), 10: summ("capacity-10")["meanScore"]}
        for n, v in sorted(A["offline_capacity_summary"].items()):
            f.write(f"{n} & {v['mean']:.1f} & {v['exact']} & {v['missing']} & {v['sec']:.0f} & {llm.get(n, float('nan')):.1f} \\\\\n".replace("nan", "—"))
        f.write("\\bottomrule\n\\end{tabular}\n")
    # capacity figure
    fig, ax = plt.subplots(figsize=(3.3, 2.2))
    ns = sorted(A["offline_capacity_summary"])
    ax.plot(ns, [A["offline_capacity_summary"][n]["mean"] for n in ns], "s-", color=C["orange"], ms=4, label="helper alone (offline)")
    ax.plot([6, 8, 10], [llm[6], llm[8], llm[10]], "o-", color=C["blue"], ms=4, label="VLM + helper (API)")
    ax.axhline(95, color=C["grey"], lw=0.8, ls="--")
    ax.text(12.1, 95.3, "95 (capacity rule)", fontsize=6.5, ha="right", color=C["grey"])
    ax.set_xlabel("Objects per room")
    ax.set_ylabel("Mean score (0\u2013100)")
    ax.set_xticks(ns)
    ax.legend(frameon=False, fontsize=7, loc="lower left")
    fig.tight_layout()
    fig.savefig(os.path.join(FIG, "capacity.pdf"))
    plt.close(fig)


# ---------------------------------------------------------------- fresh test set (never seen by any tuning decision)
fp = os.path.join(PAPER, "experiments", "offline-fresh.json")
if os.path.exists(fp):
    import random
    subprocess.run(["npx", "tsx", os.path.join(HERE, "score_rows.ts"), fp, fp.replace(".json", "-scored.json")], cwd=REPO, check=True)
    fr = json.load(open(fp.replace(".json", "-scored.json")))
    def boot(vals, n=5000, seed=0):
        rnd = random.Random(seed)
        ms = sorted(statistics.mean(rnd.choices(vals, k=len(vals))) for _ in range(n))
        return ms[int(0.025 * n)], ms[int(0.975 * n)]
    groups = {"default": [r for r in fr if "-o" not in r["name"]], "o8": [r for r in fr if r["name"].endswith("-o8")]}
    A["fresh"] = {}
    for g, rs in groups.items():
        if not rs:
            continue
        tr = lambda r: r["truth"]["objects"] if isinstance(r["truth"], dict) else r["truth"]
        sc = [r["score"] for r in rs]
        iss = [issues(r["details"], tr(r)) for r in rs]
        A["fresh"][g] = {"rooms": len(rs), "objects": sum(len(tr(r)) for r in rs), "mean": statistics.mean(sc), "ci95": boot(sc),
                         "exact": sum(r["exact"] for r in rs), "min": min(sc), "errors": sum(1 for r in rs if r["error"]),
                         "missing": sum(sum(i.startswith("missing") for i in x) for x in iss),
                         "extra": sum(r.get("extraGuesses", 0) for r in rs),
                         "rooms_with_extra": sum(1 for r in rs if r.get("extraGuesses", 0)),
                         "rooms_with_missing": sum(1 for x in iss if any(i.startswith("missing") for i in x)),
                         "shape": sum(sum(i.startswith("shape") for i in x) for x in iss),
                         "size": sum(sum(i.startswith("size") for i in x) for x in iss),
                         "pos": sum(sum(i.startswith("pos") for i in x) for x in iss),
                         "ori": sum(sum(i.startswith("ori") for i in x) for x in iss),
                         "sec": statistics.mean(r["seconds"] for r in rs),
                         "below95": sum(s < 95 for s in sc), "worst": sorted(((r["score"], r["name"]) for r in rs))[:5]}
    for g in A["fresh"]:
        v = A["fresh"][g]
        open(os.path.join(TAB, f"fresh_mean_{g}.tex"), "w").write(f"{v['mean']:.1f}")
    with open(os.path.join(TAB, "fresh.tex"), "w") as f:
        f.write("\\begin{tabular}{@{}lrrlrrrrrrrr@{}}\n\\toprule\nSet & Rooms & Obj. & Mean [95\\,\\% CI] & Exact & $<95$ & Miss. & Extra & Shape & Size & Pos. & Ori. \\\\\n\\midrule\n")
        for g, lab in (("default", "1001--1100, 2--5 obj."), ("o8", "1001--1030, 8 obj.")):
            if g in A["fresh"]:
                v = A["fresh"][g]
                f.write(f"{lab} & {v['rooms']} & {v['objects']} & {v['mean']:.1f} [{v['ci95'][0]:.1f}, {v['ci95'][1]:.1f}] & {v['exact']} & {v['below95']} & {v['missing']} & {v['extra']} & {v['shape']} & {v['size']} & {v['pos']} & {v['ori']} \\\\\n")
        f.write("\\bottomrule\n\\end{tabular}\n")

# ---------------------------------------------------------------- like-for-like ablation with the iter23 helper
lp = os.path.join(PAPER, "experiments", "offline-default-iter23helper.json")
if os.path.exists(lp):
    subprocess.run(["npx", "tsx", os.path.join(HERE, "score_rows.ts"), lp, lp.replace(".json", "-scored.json")], cwd=REPO, check=True)
    l23 = {r["name"]: r for r in json.load(open(lp.replace(".json", "-scored.json")))}
    A["offline_iter23"] = {"bench_mean": statistics.mean(l23[str(s)]["score"] for s in range(101, 111)), "dev_mean": statistics.mean(l23[str(s)]["score"] for s in range(201, 211)),
                           "bench_identical_to_api": sum(abs(l23[str(p["seed"])]["score"] - p["s2"]) < 0.05 for p in per),
                           "identical_to_final_helper": sum(abs(l23[n]["score"] - off[n]["score"]) < 0.05 for n in l23 if n in off)}
    with open(os.path.join(TAB, "llm_vs_pipeline.tex"), "w") as f:
        # helper-alone columns first: the table is the helper's primary result, the VLM + helper runs are the comparison
        f.write("\\begin{tabular}{@{}rrrrr@{}}\n\\toprule\nRoom & Objects & Helper alone, same helper & Helper alone, released helper & VLM + helper (run 1 / run 2) \\\\\n\\midrule\n")
        for p in per:
            f.write(f"{p['seed']} & {p['n']} & {l23[str(p['seed'])]['score']:.1f} & {off[str(p['seed'])]['score']:.1f} & {p['s1']:.1f} / {p['s2']:.1f} \\\\\n")
        f.write(f"\\midrule\nmean & {A['record']['objects_total']} & {A['offline_iter23']['bench_mean']:.1f} & {A['offline_summary']['bench_mean']:.1f} & {summ(REC[0])['meanScore']:.1f} / {summ(REC[1])['meanScore']:.1f} \\\\\n")
        f.write("\\bottomrule\n\\end{tabular}\n")

# ---------------------------------------------------------------- where the model intervened (final helper, capacity runs)
if "offline-capacity" in A:
    offc = {r["name"]: r for r in A["offline-capacity"]}
    inter = []
    for lab, n in (("capacity-6-b", 6), ("capacity-8-b", 8), ("capacity-8-confirm", 8), ("capacity-10", 10)):
        for r in rows(lab):
            o = offc[f"{r['seed']}-o{n}"]
            if (r["codeRuns"] or 0) > 1 or abs(r["score"] - o["score"]) > 0.05:
                inter.append({"run": lab, "seed": r["seed"], "n": n, "cells": r["codeRuns"], "api": r["score"], "offline": o["score"], "delta": r["score"] - o["score"],
                              "guess_n": len(r["guess"]["objects"]), "truth_n": len(r["truth"])})
    A["interventions"] = inter
    A["interventions_total_roomruns"] = sum(len(rows(l)) for l, _ in (("capacity-6-b", 6), ("capacity-8-b", 8), ("capacity-8-confirm", 8), ("capacity-10", 10)))
    with open(os.path.join(TAB, "interventions.tex"), "w") as f:
        f.write("\\begin{tabular}{@{}llrrrrrr@{}}\n\\toprule\nRun & Room & Objects & Cells & VLM + helper & Helper alone & Difference & Objects returned \\\\\n\\midrule\n")
        for i in inter:
            f.write(f"{i['run']} & {i['seed']} & {i['n']} & {i['cells']} & {i['api']:.1f} & {i['offline']:.1f} & {i['delta']:+.1f} & {i['guess_n']} of {i['truth_n']} \\\\\n")
        f.write("\\bottomrule\n\\end{tabular}\n")

json.dump(A, open(os.path.join(PAPER, "experiments", "analysis.json"), "w"), indent=1)
print(json.dumps({k: v for k, v in A.items() if k in ("fresh", "offline_iter23", "interventions", "effort", "variance", "offline_summary")}, indent=1))
