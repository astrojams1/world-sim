#!/usr/bin/env python3
"""Run the sandbox helper's automatic pipeline (no LLM) on rendered rooms (see scripts/render-rooms.mjs).

  python3 scripts/run-offline.py --rooms <dir> [--filter "(10[1-9]|110)-p"] --out <result.json> [--parallel 2]

Each room directory holds camera_A.jpg, camera_B.jpg, truth.json and, in platform mode, camera_A2.jpg and
camera_B2.jpg. A fresh subprocess imports src/lib/sandbox/worldsim.py, runs ws.solve_all() (static) or
ws.solve_platform() (platform rooms, detected by camera_A2.jpg) with verbose output captured to log.txt, and
returns the answer JSON and the wall time. Score the output with scripts/score-rows.ts.
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
REPO = os.path.normpath(os.path.join(HERE, ".."))
HELPER = os.path.join(REPO, "src", "lib", "sandbox", "worldsim.py")

CHILD = r"""
import json, os, sys, time
sys.path.insert(0, os.getcwd())
import worldsim as ws
t = time.time()
platform_mode = os.path.exists("camera_A2.jpg")
try:
    if platform_mode:
        r = ws.solve_platform(verbose=True)
        ans = json.loads(ws.to_json(r["objects"], r["platform"]))
    else:
        r = ws.solve_all(verbose=True)
        ans = json.loads(ws.to_json(r["objects"]))
    err = None
except Exception as e:  # noqa: BLE001
    import traceback
    traceback.print_exc()
    ans, err = {"objects": []}, f"{type(e).__name__}: {e}"
print("@@RESULT@@" + json.dumps({"guess": ans, "seconds": round(time.time() - t, 1), "error": err}))
"""


def run_room(room_dir, helper=HELPER):
    name = os.path.basename(room_dir)
    truth = json.load(open(os.path.join(room_dir, "truth.json")))
    work = os.path.join(room_dir, "_offline")
    os.makedirs(work, exist_ok=True)
    for f in ("camera_A.jpg", "camera_B.jpg", "camera_A2.jpg", "camera_B2.jpg"):
        src = os.path.join(room_dir, f)
        dst = os.path.join(work, f)
        if os.path.exists(src) and not os.path.exists(dst):
            os.link(src, dst)
    with open(os.path.join(work, "worldsim.py"), "w") as fh:
        fh.write(open(helper).read())
    log = os.path.join(work, "session_log.txt")
    if os.path.exists(log):
        os.remove(log)
    t = time.time()
    p = subprocess.run([sys.executable, "-c", CHILD], cwd=work, capture_output=True, text=True, timeout=1800)
    line = [l for l in p.stdout.splitlines() if l.startswith("@@RESULT@@")]
    if line:
        res = json.loads(line[-1][len("@@RESULT@@"):])
    else:
        res = {"guess": {"objects": []}, "seconds": round(time.time() - t, 1), "error": (p.stderr or p.stdout)[-800:]}
    open(os.path.join(work, "log.txt"), "w").write(p.stdout + "\n" + p.stderr)
    return {"name": name, "truth": truth, "guess": res["guess"], "seconds": res["seconds"], "error": res["error"]}


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
        print(r["name"], len(r["guess"].get("objects", [])), "objects", r["seconds"], "s", r["error"] or "")
    json.dump(rows, open(a.out, "w"), indent=1)


if __name__ == "__main__":
    main()
