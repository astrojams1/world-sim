# Paper: How Cheap Can an Explicit World Model Get Without Training?

Produced by the `research-paper` skill (astrojams1/skills, `skills/research-paper`, v0.2.0); run log in that
repository under `skills/research-paper/ledger/runs/2026-09-05-world-sim-cheap-world-model.md`.

## Rebuild

```bash
# from the repo root
npm install                                  # once; provides tsx for the scorer wrapper
python3 paper/cheap-world-model/scripts/analyze_bench.py     # tables/ and figures/ from bench/results and experiments/
bash <skills>/skills/research-paper/scripts/build.sh paper/cheap-world-model --strict   # build/main.pdf
bash <skills>/skills/research-paper/scripts/bundle.sh paper/cheap-world-model           # build/arxiv-bundle.tar.gz
```

## Regenerate the offline experiments

```bash
OPENAI_API_KEY=dummy npm run dev &            # rendering only; no API call is made
CHROMIUM_PATH=/opt/pw-browsers/chromium node paper/cheap-world-model/scripts/render_rooms.mjs --seeds 101-110,201-210 --out paper/cheap-world-model/experiments/rooms
node paper/cheap-world-model/scripts/render_rooms.mjs --seeds 1001-1100 --out paper/cheap-world-model/experiments/rooms-fresh
cd paper/cheap-world-model
python3 scripts/run_offline.py --rooms experiments/rooms --filter "(10[1-9]|110|20[1-9]|210)" --out experiments/offline-default.json
python3 scripts/run_offline.py --rooms experiments/rooms --filter "(10[1-9]|110|20[1-9]|210)" --helper experiments/worldsim-iter23.py --out experiments/offline-default-iter23helper.json
python3 scripts/run_offline.py --rooms experiments/rooms --filter ".*-o(6|8|10|12)" --out experiments/offline-capacity.json
python3 scripts/run_offline.py --rooms experiments/rooms-fresh --out experiments/offline-fresh.json
```

## Files

`00-`…`10-*.md` are the skill's stage artifacts (understanding, research question, contributions, literature,
novelty, decisions, experiments, outline, the two reviews with responses, submission checks). `literature/`
holds the search log, raw API responses, per-theme notes and the full bibliography. `experiments/` holds the
rendered rooms, offline results and `analysis.json` (every number in the paper).
