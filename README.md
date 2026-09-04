# World Sim — a world model from a cheap LLM

A small experiment: can a cheap vision LLM reconstruct a 3D room from two fixed camera feeds?

- A random 1×1×1 room is generated (JSON): 2–5 red/blue spheres and cubes resting on the floor, random wall/floor/ceiling colours and lighting, and two fixed cameras mounted high on two different walls.
- The page shows a rotatable 3D view of the room plus the two camera feeds (rendered with three.js in the browser).
- **Refresh** generates a new room. **Analyze** sends the two feeds plus a *skill* to a cheap OpenAI vision model, which must return the room's object JSON. The result is scored against the ground truth (100% = exact match within tolerance).

## The skill

The whole point is the prompt design in [`src/lib/skill.ts`](src/lib/skill.ts) plus the sandbox helper in [`src/lib/sandbox/worldsim.py`](src/lib/sandbox/worldsim.py). Naively asking "look at these images and output the JSON" is very inaccurate, so instead the model runs a real **guess → render → compare → re-guess** loop itself, inside one response, using OpenAI's hosted Python sandbox (the `code_interpreter` tool):

1. The two camera images are sent to the model **unaltered** (no overlays, markers or crops), both as image inputs and as files in its sandbox, together with `scene.json` (camera calibration and surface colours) and `worldsim.py`.
2. The system prompt states the rules of the world (shapes, colours, the discrete size set 0.10 / 0.15 / 0.20, the 0.05 position grid, objects rest on the floor so `y = size/2`) and the camera calibration.
3. `worldsim.py` gives the model measurement and verification primitives: `blobs()` finds red/blue regions with pixel measurements, `plane_point()`/`project()` do the camera geometry, `initial_hypothesis()` turns blobs plus the shapes the model *saw* into a first guess, `compare()` renders the hypothesis silhouettes from both cameras and reports IoU, per-object pixel offsets, phantom objects and unexplained blobs, `shape_test()` checks sphere vs cube, and `local_search()` refines positions and sizes against the images. Shapes, colours and the object count are deliberately left to the model's own vision.
4. The method section tells the model to inventory visually, measure, hypothesise, check, and re-guess until both cameras are explained, then emit the snapped JSON. Structured output puts a `notes` field before `objects`.

The client just uploads the feeds, starts a background response and polls for the result. The model's full Python session (the code of every run plus the printed transcript, which the sandbox bootstrap tees into a log file fetched via the containers API) is shown in the UI. `gpt-5-mini` reliably uses the sandbox; `gpt-4.1-mini` sometimes answers without running code, which the UI flags.

## Scoring

`src/lib/score.ts` matches guessed objects to true objects (exhaustive assignment) and awards per object: shape 20%, colour 20%, size 20%, position 40%. Position/size within tolerance (0.03 units / 0.012) get full credit and decay linearly beyond. Extra objects cost as much as a missing one. A score of 100 is only given when every object is matched exactly with no extras.

## Models

Default is `gpt-5-mini` (cheap, accepts images, has built-in reasoning, uses the sandbox reliably). `gpt-5.4-mini`, `gpt-5-nano`, `gpt-4.1-mini` and `gpt-4o-mini` are selectable. Reasoning effort applies to the gpt-5 family. A run takes roughly 1–4 minutes and a few cents (model tokens plus one code-interpreter session).

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
