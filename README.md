# World Sim — a world model from a cheap LLM

A small experiment: can a cheap vision LLM reconstruct a 3D room from two fixed camera feeds?

- A random 1×1×1 room is generated (JSON): 2–5 red/blue spheres and cubes resting on the floor, random wall/floor/ceiling colours and lighting, and two fixed cameras mounted high on two different walls.
- The page shows a rotatable 3D view of the room plus the two camera feeds (rendered with three.js in the browser).
- **Refresh** generates a new room. **Analyze** sends the two feeds plus a *skill* to a cheap OpenAI vision model, which must return the room's object JSON. The result is scored against the ground truth (100% = exact match within tolerance).

## The skill

The whole point is the prompt design in [`src/lib/skill.ts`](src/lib/skill.ts). Naively asking "look at these images and output the JSON" is very inaccurate, so the skill gives the model:

1. **The rules of the world** — object shapes/colours, the discrete size set (0.10 / 0.15 / 0.20), the 0.05 position grid, objects rest on the floor so `y = size/2`.
2. **Camera calibration** — position, look-at and field of view of both cameras, plus a landmark table mapping known floor points and ceiling corners to pixel coordinates, and "a 0.10 object at (x,z) is N px wide" size references.
3. **A guess → check → re-guess procedure** — inventory each view, correspond objects across views, locate each contact point on the floor independently from both cameras, size against the grid, then project the estimate back into each image and revise until both views are consistent.
4. **Structured output** with a `notes` field before `objects`, so non-reasoning models write their working before committing.

The camera images are sent **unaltered** — no overlays, markers or crops. All calibration help is text.

Optionally (Rounds ≥ 2) the app renders the model's guess from the same two cameras and sends those renders back alongside the real feeds, with the pixel location each guessed object implies. The model compares and corrects. This is the guess-check-reguess loop made external and exact.

## Scoring

`src/lib/score.ts` matches guessed objects to true objects (exhaustive assignment) and awards per object: shape 20%, colour 20%, size 20%, position 40%. Position/size within tolerance (0.03 units / 0.012) get full credit and decay linearly beyond. Extra objects cost as much as a missing one. A score of 100 is only given when every object is matched exactly with no extras.

## Models

Default is `gpt-5-mini` (cheap, accepts images, has built-in reasoning). `gpt-5.4-mini`, `gpt-5-nano`, `gpt-4.1-mini` and `gpt-4o-mini` are selectable. Reasoning effort applies to the gpt-5 family.

## Running locally

```bash
cp .env.example .env.local   # add your OPENAI_API_KEY
npm install
npm run dev
```

## Deploying to Vercel

1. Import the repo in Vercel (framework preset: Next.js, no extra settings).
2. Add the environment variable `OPENAI_API_KEY` (Production + Preview).
3. Deploy. The analyze route sets `maxDuration = 60`; if you use `high` reasoning effort with many rounds, consider raising it on a plan that allows it.
