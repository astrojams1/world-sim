#!/usr/bin/env python3
"""Run the sandbox helper's automatic pipeline (solve_all, no LLM) on rendered rooms.

  python3 run_offline.py --rooms experiments/rooms --filter "(10[1-9]|110)" --out experiments/offline-default.json [--helper experiments/worldsim-iter23.py]

For each room directory (camera_A.jpg, camera_B.jpg, truth.json) a fresh subprocess imports worldsim.py from
the repo (src/lib/sandbox/worldsim.py), runs ws.solve_all(verbose=False) and returns the answer JSON and the
wall time. The output is a list of {name, truth, guess, seconds, error}; score it with score_rows.ts.
This is the "pipeline alone" ablation: exactly what the LLM would get from one cell, with no reconciliation.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", "..", ".."))
HELPER = os.path.join(REPO, "src", "lib", "sandbox", "worldsim.py")

CHILD = r"""
import json, os, sys, time
sys.path.insert(0, os.getcwd())
import worldsim as ws
t = time.time()
try:
    r = ws.solve_all(verbose=False)
    objs = json.loads(ws.to_json(r["objects"]))["objects"]
    err = None
except Exception as e:  # noqa: BLE001
    objs, err = [], f"{type(e).__name__}: {e}"
print("@@RESULT@@" + json.dumps({"objects": objs, "seconds": round(time.time() - t, 1), "error": err}))
"""


def run_room(room_dir, helper=HELPER):
    name = os.path.basename(room_dir)
    truth = json.load(open(os.path.join(room_dir, "truth.json")))
    work = os.path.join(room_dir, "_offline")
    os.makedirs(work, exist_ok=True)
    for f in ("camera_A.jpg", "camera_B.jpg"):
        if not os.path.exists(os.path.join(work, f)):
            os.link(os.path.join(room_dir, f), os.path.join(work, f))
    with open(os.path.join(work, "worldsim.py"), "w") as fh:
        fh.write(open(helper).read())
    t = time.time()
    p = subprocess.run([sys.executable, "-c", CHILD], cwd=work, capture_output=True, text=True, timeout=1800)
    line = [l for l in p.stdout.splitlines() if l.startswith("@@RESULT@@")]
    if line:
        res = json.loads(line[-1][len("@@RESULT@@"):])
    else:
        res = {"objects": [], "seconds": round(time.time() - t, 1), "error": (p.stderr or p.stdout)[-800:]}
    open(os.path.join(work, "log.txt"), "w").write(p.stdout + "\n" + p.stderr)
    return {"name": name, "truth": truth, "guess": {"objects": res["objects"]}, "seconds": res["seconds"], "error": res["error"]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rooms", required=True)
    ap.add_argument("--filter", default=".*")
    ap.add_argument("--out", required=True)
    ap.add_argument("--parallel", type=int, default=2)
    ap.add_argument("--helper", default=HELPER, help="path to the worldsim.py version to run (default: the repo's current file)")
    a = ap.parse_args()
    dirs = sorted(d for d in os.listdir(a.rooms) if re.match(a.filter + "$", d) and os.path.isdir(os.path.join(a.rooms, d)))
    print(f"{len(dirs)} rooms")
    with ThreadPoolExecutor(a.parallel) as ex:
        rows = list(ex.map(lambda d: run_room(os.path.join(a.rooms, d), a.helper), dirs))
    for r in rows:
        print(r["name"], len(r["guess"]["objects"]), "objects", r["seconds"], "s", r["error"] or "")
    json.dump(rows, open(a.out, "w"), indent=1)


if __name__ == "__main__":
    main()
