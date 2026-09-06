#!/usr/bin/env python3
"""Compare two scripts/run-offline.py outputs room by room and report the rooms whose answers differ.
  python3 scripts/compare-offline.py before.json after.json
Used as the mode-1 bit-identity guard: run the committed helper and the working-tree helper on the same rendered
static rooms (`--helper` selects the file) and expect "identical". Exit code 1 when any room differs.
"""
import json
import sys

a = {r["name"]: r for r in json.load(open(sys.argv[1]))}
b = {r["name"]: r for r in json.load(open(sys.argv[2]))}
names = sorted(set(a) | set(b))
bad = [n for n in names if json.dumps(a.get(n, {}).get("guess"), sort_keys=True) != json.dumps(b.get(n, {}).get("guess"), sort_keys=True)]
if bad:
    print(f"{len(bad)} of {len(names)} rooms differ: {', '.join(bad)}")
    for n in bad[:3]:
        print(f"  {n}\n    before {json.dumps(a.get(n, {}).get('guess'))[:300]}\n    after  {json.dumps(b.get(n, {}).get('guess'))[:300]}")
    sys.exit(1)
print(f"identical answers on all {len(names)} rooms")
