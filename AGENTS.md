<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Working in this repo (read before starting; the tune-skill skill has the details)

- **Branching**: start every task on a fresh branch from `main` (`git fetch origin main && git checkout -B <branch> origin/main`). Records and finished work go to `main` through a PR that the session merges itself (`create_pull_request`, `merge_pull_request`); production deploys from `main`.
- **The OpenAI key lives only on Vercel production.** There is no `OPENAI_API_KEY` in the sandbox or in `.env.local`, and Vercel preview deployments do not have it. Project `world-sim` (team `astrojams1s-projects`), production URL `https://world-sim-delta.vercel.app`; `GET /api/analyze?id=bad` answers 400 when the key is present and 500 "OPENAI_API_KEY is not set" when it is not.
- **Running the benchmark from a sandbox** (what earlier sessions did; repeat it, do not rediscover it):
  1. Merge the code under test into `main` (production must run the helper and prompt being measured).
  2. Wait until the production deployment of that merge commit is READY (Vercel MCP `get_deployment` on `world-sim-delta.vercel.app`, or `list_deployments` for project `prj_A9f2WQCc2JT0HCkmCdgb4q3TvaOU`).
  3. `npm run dev` locally (no key needed: it only renders the rooms), then
     `NODE_USE_ENV_PROXY=1 CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node scripts/bench.mjs --label <label> [--mode platform | --objects N] --effort low --api https://world-sim-delta.vercel.app --parallel 3`
     The page renders in the local headless browser; only its `/api/analyze` requests are answered by production, with the same body and the same runtime anti-cheat check. About 4-5 minutes and $0.32 per ten-room run. Never more than 3 rooms in parallel.
  4. The sandbox's headless Chromium cannot open `*.vercel.app` itself (the TLS tunnel through the agent proxy drops during the handshake); `curl` and Node `fetch` (with `NODE_USE_ENV_PROXY=1`) can. Do not build a local forwarding server for this; `--api` is the supported path.
- **Offline first**: the helper alone can be tested without the key (`scripts/render-rooms.mjs`, `scripts/run-offline.py`, `scripts/score-rows.ts`), and any helper change made for one axis must keep mode 1 bit-identical (`scripts/compare-offline.py`, see the tune-skill skill).
- **Gates before every commit**: `node scripts/embed-sandbox.mjs`, `npx eslint src scripts`, `npx tsc --noEmit -p .`, `npm run check:no-cheating`; after UI changes also `npm run check:mobile` (needs `npm run dev`). Records and every attempted iteration are logged in `bench/BENCH.md`.
- **Tuning loop**: `/loop /tune-skill` runs one iteration per firing over three axes (mode 1, capacity, mode 2); its record rule needs two confirming runs.
