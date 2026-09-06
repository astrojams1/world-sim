#!/usr/bin/env python3
"""Experiment: solve mode-2 rooms with ONE camera (its two snapshots) instead of two.

  python3 scripts/mono-experiment.py --rooms bench/rooms --camera A --out /tmp/mono-A.json [--filter ".*-p"]
  npx tsx scripts/score-rows.ts /tmp/mono-A.json

Mode 2 itself is untouched: this script imports the helper and reuses its tools with the single camera's pose
passed for both "cameras" (the tools are symmetric in their two poses). What changes without a second view:
  - the plane is fitted to the green cross-section of one image (fit_platform with one pose);
  - the normal's sign is "toward the camera" (an object on the far side would be hidden by the opaque plane);
  - object positions come from the pixel ray meeting the resting plane of each legal size, the size being the
    one whose apparent width at that depth matches the blob (no triangulation, no blob pairing, no frame
    alignment; a blob merged in this view stays one object);
  - the displacement comes from each object's blob in the second snapshot met with the same plane, refined by
    the same silhouette descent.
Output rows have the run-offline.py shape, so score-rows.ts scores them.
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
import json, math, os, sys, time
import numpy as np
sys.path.insert(0, os.getcwd())
import worldsim as ws

CAM = sys.argv[1]
t0 = time.time()


def ray_plane(pose, uv, plat, height):
    # point where the pixel ray meets the plane parallel to the platform at `height` above it (objects' side)
    c, d, n, e = ws._platform_frame(plat)
    o, r = pose.ray(*uv)
    nd = float(n @ r)
    if abs(nd) < 1e-6:
        return None
    t = (height - float(n @ (o - c))) / nd
    return None if t <= 0 else o + t * r


def mono_objects(pose, blobs, plat):
    objs = []
    for b in blobs:
        shape = "sphere" if b["circularity"] > 0.95 else "cube"
        best = None
        for s in ws.SIZES:
            p = ray_plane(pose, b["centroid"], plat, s / 2)
            if p is None or not all(-0.05 <= v <= 1.05 for v in p):
                continue
            implied = ws.apparent_size(pose, b, p, shape)  # size implied by the blob width at this depth
            err = abs(implied - s)
            if best is None or err < best[0]:
                best = (err, s, p)
        if best is None:
            continue
        o = {"shape": shape, "color": b["color"], "size": best[1], "position": [float(v) for v in best[2]]}
        if shape == "cube":
            o["rotation"] = [0.0, 0.0, 0.0]
        objs.append(o)
    return objs


def mono_displacement(objs, plat, pose):
    c, d, n, e = ws._platform_frame(plat)
    deltas = []
    second = ws.blobs(pose.cam_id + "2", verbose=False)
    for o in objs:
        pr = pose.project(o["position"])
        cands = [b for b in second if b["color"] == o["color"]]
        if pr is None or not cands:
            continue
        b = min(cands, key=lambda b: math.hypot(b["centroid"][0] - pr[0], b["centroid"][1] - pr[1]))
        if math.hypot(b["centroid"][0] - pr[0], b["centroid"][1] - pr[1]) > 150:
            continue
        p2 = ray_plane(pose, b["centroid"], plat, o["size"] / 2)
        if p2 is None:
            continue
        delta = p2 - np.asarray(o["position"], dtype=float)
        deltas.append([float(delta @ d), float(delta @ e)])
    a, b_ = (0.0, 0.0) if not deltas else tuple(float(v) for v in np.median(np.array(deltas), axis=0))
    poses = (pose, pose)
    score = lambda a, b: ws._motion_score(objs, poses, a * d + b * e)  # noqa: E731
    best = score(a, b_)
    for step in (0.02, 0.01, 0.005, 0.002, 0.001, 0.0005):
        improved = True
        while improved:
            improved = False
            for da, db in ((step, 0), (-step, 0), (0, step), (0, -step)):
                sc = score(a + da, b_ + db)
                if sc > best + 1e-6:
                    best, a, b_, improved = sc, a + da, b_ + db, True
    shift = a * d + b_ * e
    return ws._platform_normalised({"position": plat["position"], "normal": plat["normal"], "axis": plat["axis"], "velocity": shift / ws.SNAPSHOT_INTERVAL}), best


try:
    ws._PLATFORM_MODE = True
    ws.set_platform(None)
    pose = ws.solve_camera(CAM, verbose=False)
    blobs = ws.blobs(CAM, verbose=False)
    plat = ws.fit_platform(pose, pose, verbose=False)
    plat = ws._platform_sign(plat, [], pose)  # toward the camera
    ws.set_platform(plat)
    objs = ws.snap(mono_objects(pose, blobs, plat))
    if not objs:
        raise RuntimeError("no objects")
    objs = ws.local_search(objs, pose, pose, passes=3, verbose=False)
    rec = ws.shape_check(objs, pose, pose, cube_margin=0.03, shading_override=0.06, verbose=False)
    objs = ws.snap(ws.apply_shapes(objs, rec))
    objs = ws.local_search(objs, pose, pose, verbose=False)
    before = objs
    objs = ws.refine_all_rotations(objs, pose, pose, verbose=False)
    if any(a["size"] != b["size"] for a, b in zip(objs, before)):
        objs = ws.local_search(objs, pose, pose, passes=2, try_sizes=False, verbose=False)
    plat, fit2 = mono_displacement(objs, plat, pose)
    ws.set_platform(plat)
    objs = ws.snap(objs)
    ans = json.loads(ws.to_json(objs, plat))
    err = None
    extra = {"plane_iou": round(ws._platform_score(plat, (pose,)), 3), "motion_fit": round(fit2, 3), "blobs": len(blobs)}
except Exception as ex:  # noqa: BLE001
    import traceback
    traceback.print_exc()
    ans, err, extra = {"objects": []}, f"{type(ex).__name__}: {ex}", {}
print("@@RESULT@@" + json.dumps({"guess": ans, "seconds": round(time.time() - t0, 1), "error": err, "extra": extra}))
"""


def run_room(room_dir, camera):
    name = os.path.basename(room_dir)
    truth = json.load(open(os.path.join(room_dir, "truth.json")))
    work = os.path.join(room_dir, f"_mono_{camera}")
    os.makedirs(work, exist_ok=True)
    for f in ("camera_A.jpg", "camera_B.jpg", "camera_A2.jpg", "camera_B2.jpg"):
        src, dst = os.path.join(room_dir, f), os.path.join(work, f)
        if os.path.exists(src) and not os.path.exists(dst):
            os.link(src, dst)
    with open(os.path.join(work, "worldsim.py"), "w") as fh:
        fh.write(open(HELPER).read())
    t = time.time()
    p = subprocess.run([sys.executable, "-c", CHILD, camera], cwd=work, capture_output=True, text=True, timeout=1800)
    line = [l for l in p.stdout.splitlines() if l.startswith("@@RESULT@@")]
    res = json.loads(line[-1][len("@@RESULT@@"):]) if line else {"guess": {"objects": []}, "seconds": round(time.time() - t, 1), "error": (p.stderr or p.stdout)[-800:], "extra": {}}
    open(os.path.join(work, "log.txt"), "w").write(p.stdout + "\n" + p.stderr)
    return {"name": name, "camera": camera, "truth": truth, "guess": res["guess"], "seconds": res["seconds"], "error": res["error"], **res.get("extra", {})}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rooms", required=True)
    ap.add_argument("--camera", required=True, choices=["A", "B"])
    ap.add_argument("--filter", default=".*-p")
    ap.add_argument("--out", required=True)
    ap.add_argument("--parallel", type=int, default=2)
    a = ap.parse_args()
    dirs = sorted(d for d in os.listdir(a.rooms) if re.match(a.filter + "$", d) and os.path.isdir(os.path.join(a.rooms, d)))
    with ThreadPoolExecutor(a.parallel) as ex:
        rows = list(ex.map(lambda d: run_room(os.path.join(a.rooms, d), a.camera), dirs))
    for r in rows:
        print(r["name"], a.camera, len(r["guess"].get("objects", [])), "objects", r["seconds"], "s", r["error"] or "")
    json.dump(rows, open(a.out, "w"), indent=1)


if __name__ == "__main__":
    main()
