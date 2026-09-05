# World Sim — a world model from a cheap LLM

A small experiment: can a cheap vision LLM reconstruct a 3D room from two photographs, given nothing but the photographs?

- A random 1×1×1 room is generated (JSON): 2–5 red/blue spheres and cubes floating anywhere inside it (cubes randomly rotated), random wall/floor/ceiling colours and lighting, and two cameras on a virtual sphere outside the room looking in. Seen from outside, the renderer culls the near faces, so each feed shows the room as an open box against black.
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
```

`worldsim.py` is embedded into the build by `scripts/embed-sandbox.mjs` (runs automatically before `dev` and `build`). Edit the `.py` file, not the generated `worldsim_py.ts`.
