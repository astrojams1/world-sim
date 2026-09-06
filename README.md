# World Sim — a world model from a cheap LLM

A small experiment: can a cheap vision LLM reconstruct a 3D room from two photographs, given nothing but the photographs?

The app has two **modes**, selected on the page; every mode shares the room, the cameras, the object vocabulary, the scorer and the sandbox helper:

- **Mode 1, static room** (the original task and the benchmark record): objects float anywhere in the room; two images.
- **Mode 2, moving platform**: the objects rest on an infinite, featureless green plane of any orientation that moves at a constant velocity within itself; each camera takes two snapshots and the model must also return the plane's position, normal and velocity, which it can only read from the objects' motion. See [Mode 2](#mode-2-moving-platform) below.

- A random 1×1×1 room is generated (JSON): 2–5 red/blue spheres and cubes floating anywhere inside it (cubes randomly rotated), random wall/floor/ceiling colours and lighting, and two cameras on a virtual sphere outside the room looking in. Seen from outside, the renderer culls the near faces, so each feed shows the room as an open box against black. The **Objects** select fixes the object count (2–12) for the same seed instead of the default draw of 2–5; the count is never sent to the model.
- The page shows a rotatable 3D view of the room plus the two camera feeds (rendered with three.js in the browser).
- **Refresh** generates a new room. **Analyze** sends the two feeds plus a *skill* to a cheap OpenAI vision model, which must return the room's object JSON. The result is scored against the ground truth (100% = exact match within tolerance).

## What the model receives

Only these, nothing else:

1. The two camera images, **unaltered** (no overlays, markers or crops).
2. That the room is a 1×1×1 cube and the two images are two views of it from unknown viewpoints.
3. The generator's rules for objects: 2–5 objects, sphere or cube, pure red or pure blue, sizes 0.10 / 0.15 / 0.20, positions on a 0.05 grid, floating, cubes at any orientation (reported as Euler XYZ radians).
4. The task: the output JSON format.

No camera calibration and no surface colours are passed. Because nothing tells the model which corner of the room is the origin, scoring is invariant to the room's 48 symmetries (`src/lib/score.ts`); the model must simply use one consistent frame for both cameras.

## The skill

The prompt lives in [`src/lib/skill.ts`](src/lib/skill.ts) and the sandbox helper in [`src/lib/sandbox/worldsim.py`](src/lib/sandbox/worldsim.py). The model runs a real **calibrate → measure → guess → render → compare → re-guess** loop itself, inside one response, using OpenAI's hosted Python sandbox (the `code_interpreter` tool). Every number the helper uses comes from the images or from the unit-cube geometry:

- `room_outline` traces the room's silhouette and finds its six corner pixels.
- `solve_camera` fits each camera's pose and focal length to those corners (all valid corner labellings are tried; they differ only by a room symmetry).
- `align` puts camera B in camera A's frame by scoring the 48 candidate frames with the colours of faces visible in both images and the triangulation of same-colour blobs.
- `blobs`, `auto_match`, `triangulate`, `initial_hypothesis`, `object_from_pixels` turn blob measurements (or pixel centres the model reads off the images) into a first hypothesis.
- `compare` renders the hypothesis silhouettes from both solved cameras and reports IoU, per-object pixel offsets, phantom objects and unexplained blobs; `shape_test` and `local_search` (positions, sizes, cube rotations) refine it.

Shapes, colours and the object count are deliberately left to the model's own vision: overlapping same-colour objects merge into one blob, and only the model can tell that it is looking at two objects.

The client uploads the feeds, starts a background response and polls for the result. The model's full Python session (the code of every run plus the printed transcript, which the bootstrap tees into a log file fetched via the containers API) is shown in the UI. `gpt-5-mini` reliably uses the sandbox; `gpt-4.1-mini` sometimes answers without running code, which the UI flags.

## Scoring

`src/lib/score.ts` matches guessed objects to true objects (exhaustive assignment) under the best of the room's 48 symmetries and awards per object: shape 20%, colour 20%, size 20%, and for spheres position 40%; for cubes position 30% and orientation 10%. Position/size within tolerance (0.03 units / 0.012) get full credit and decay linearly beyond. Orientation error is the angle between the guessed and true rotation minimised over the cube's 24 rotational symmetries (and transformed by the room frame in use); within 10° is full credit, decaying to zero at 45°. Extra objects cost as much as a missing one. A score of 100 is only given when every object is matched exactly with no extras.

## Mode 2: moving platform

- The generator (`generateRoom(seed, count, "platform")`) draws an infinite plane, pure green and featureless, tilted up to 40° from horizontal (`PLATFORM_MAX_TILT`) and passing within 0.25 of the room's centre (`PLATFORM_OFFSET`), and gives it a constant speed of 0.1–0.3 units/s in a random direction within the plane. Inside the room the plane fills its whole cross-section, meeting the walls (the renderer clips it to the room). 2–4 objects (or an exact count of 2–6) rest on its top side: gravity acts along the plane's normal, so spheres touch it and cubes sit flat on a face with a random yaw. Every object stays inside the room at both snapshots. Platform-mode walls are never green.
- Each camera takes two snapshots `SNAPSHOT_INTERVAL` = 0.5 s apart (the cameras do not move), so the page shows four feeds and the model receives four images: A, B (first snapshot) and A2, B2 (second snapshot). The plane looks identical in both snapshots; only the objects have moved, all by the same displacement.
- The ground truth is `{ platform: { position, normal, velocity }, objects }`, all at the first snapshot: the plane's point closest to the room's centre (an infinite plane has no other location), the unit normal of its top side (pointing toward the objects) and its velocity in room units per second; object positions are continuous room coordinates (not on a grid) and cube rotations are Euler XYZ as in mode 1.

**What the model receives in mode 2** (and nothing more): the four unaltered images; the rules above as fixed constants (tilt range, offset range, speed range, snapshot interval, "in-plane motion", objects rest on the top side); the output JSON format. As in mode 1, no camera calibration, no colours, no object count and no per-room data. The snapshot interval is a fixed rule of the world, not per-room information: without it a velocity would not be measurable at all.

**Scoring**: the objects are scored exactly as in mode 1 and carry 70% of the total; the platform carries 30% (plane offset along the true normal within 0.03, normal within 5°, velocity within 0.015 units of displacement per snapshot interval, i.e. 0.03 units/s; each decays linearly beyond its tolerance). Everything is scored under the best of the room's 48 symmetries, applied to the platform's vectors as well. 100 requires every object and the platform exact.

**The helper in mode 2** (`ws.solve_platform()`): the same camera calibration and frame alignment (a frame in which the green cross-section cannot be fitted is rejected), then the plane's three degrees of freedom (normal and offset) are fitted to its green cross-section in both first-snapshot images (a coarse grid over normals and offsets, then coordinate descent; object pixels are neutral because objects stand on the plane), the object pipeline runs under a *resting on the platform* constraint (positions move in the plane, heights follow from the size, cube rotations reduce to a yaw about the normal, unpaired blobs are explained on the resting plane), and the objects' common displacement between the snapshots is found by matching each object to its blob in the second snapshots and then descending in the plane on their silhouette overlap. The velocity is that displacement over the interval; the plane itself contributes nothing to it. Offline (no LLM) the pipeline scores 100.0 on the seeds 101–110 in platform mode (10 exact) and 100.0 on the held-out 201–210 (10 exact), about 17.1 s per room (`bench/BENCH.md`).

## Models

Default is `gpt-5-mini` (cheap, accepts images, has built-in reasoning, uses the sandbox reliably). `gpt-5.4-mini`, `gpt-5-nano`, `gpt-4.1-mini` and `gpt-4o-mini` are selectable. Reasoning effort applies to the gpt-5 family and defaults to `low`: on the benchmark, low effort scores the same as medium at roughly half the time and 30% fewer tokens. A run takes roughly 15-40 s and about 3 cents (model tokens plus one code-interpreter session); the benchmark record is in `bench/BENCH.md`.

## Running locally

```bash
cp .env.example .env.local   # add your OPENAI_API_KEY
npm install
npm run dev
```

## Deploying to Vercel

1. Import the repo in Vercel (framework preset: Next.js, no extra settings).
2. Add the environment variable `OPENAI_API_KEY` (Production + Preview).
3. Deploy. The analyze route only starts a background response and polls it, so each function invocation is short (`maxDuration = 60`).

## Benchmarking the skill

```bash
npm run dev                        # with OPENAI_API_KEY in .env.local
npx playwright install chromium    # once
npm run bench -- --n 10 --model gpt-5-mini
npm run bench -- --label capacity-8 --objects 8   # the capacity axis: every room gets exactly 8 objects
npm run bench -- --label platform-1 --mode platform  # mode 2 on the same seeds (four images per room)
```

The helper can be tested without the API: `node scripts/render-rooms.mjs --seeds 101-110 --mode platform --out bench/rooms` saves the feeds and truth of each room (with `npm run dev` running), `python3 scripts/run-offline.py --rooms bench/rooms --out out.json` runs `solve_all`/`solve_platform` on them, and `npx tsx scripts/score-rows.ts out.json` scores the answers with the app's scorer.

Two optimisation axes are tracked in `bench/BENCH.md`: the default benchmark (seeds 101–110, 2–5 objects: score, time, tokens, cost) and **capacity**, the largest object count at which the same seeds still score at least 95. The tuning loop (`/tune-skill`) works both.

`npm run check:mobile` (with `npm run dev` running) drives the page with Playwright on phone, tablet and desktop viewports in both modes, before and after a mocked analysis, and fails on horizontal overflow, controls under 40 px or under 16 px text on phones, a 3D canvas that overflows its box, or a viewer that swallows vertical swipes. `bench/mobile/` (ignored) receives screenshots with `--shots`.

`scripts/check-no-cheating.mjs` (`npm run check:no-cheating`) is the static anti-cheat gate for both modes: the request may carry only the model, the reasoning effort, the mode and the images; the prompt is a function of the mode alone; the helper opens only the camera images.

`worldsim.py` is embedded into the build by `scripts/embed-sandbox.mjs` (runs automatically before `dev` and `build`). Edit the `.py` file, not the generated `worldsim_py.ts`.
