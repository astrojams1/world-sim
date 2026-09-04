import { GRID, SIZES } from "./room";

/**
 * The "skill" given to the cheap vision model.
 *
 * The model receives ONLY: the two unaltered camera images, the fact that the room is a 1 x 1 x 1 cube seen from
 * two viewpoints, the generator's rules for objects, and the task (the output JSON). No camera calibration and no
 * surface colours are passed. The model gets a Python sandbox containing the two images and worldsim.py
 * (src/lib/sandbox/worldsim.py), whose tools derive everything else from the images: it finds the room's outline,
 * solves each camera's pose and focal length from the known unit cube, triangulates objects, and renders/compares
 * hypotheses so the model can run its guess -> check -> re-guess loop inside one response.
 */

export const SANDBOX_FILES = {
  helper: "worldsim.py",
  A: "camera_A.jpg",
  B: "camera_B.jpg",
} as const;

export const SESSION_LOG = "session_log.txt";

export const BOOTSTRAP_SNIPPET = `import os, shutil, sys
for f in os.listdir('/mnt/data'):
    for name in ('worldsim.py', 'camera_A.jpg', 'camera_B.jpg'):
        if f.endswith(name) and f != name:
            shutil.copy(os.path.join('/mnt/data', f), os.path.join('/mnt/data', name))
sys.path.insert(0, '/mnt/data')
class _Tee:  # keep a transcript of everything printed in /mnt/data/session_log.txt
    def __init__(self, *streams): self.streams = streams
    def write(self, data):
        for s in self.streams: s.write(data)
    def flush(self):
        for s in self.streams: s.flush()
_log = open('/mnt/data/session_log.txt', 'a')
sys.stdout = _Tee(sys.stdout, _log)
sys.stderr = _Tee(sys.stderr, _log)
import worldsim as ws`;

export function buildSystemPrompt(): string {
  const sizes = SIZES.map((s) => s.toFixed(2)).join(", ");
  return `You are a precise 3D scene-reconstruction system. You receive two photographs of a room, taken from two different unknown viewpoints, and must reconstruct the exact scene description as JSON. You are scored on exact agreement with the ground truth, so precision matters more than speed. You have a Python sandbox; use it to measure, to calibrate the cameras, to render your hypothesis, and to compare it against the photographs. Never guess a number you could measure.

## What you know (and nothing more)
- The room is a cube, 1.0 x 1.0 x 1.0 units. Coordinates are in [0, 1] along x, y (up) and z. The two photographs are two views of the same room from two different, unknown camera positions outside the room. Nothing else about the cameras is known.
- It contains between 2 and 5 objects. Every object is either a "sphere" or a "cube", and is either pure "red" or pure "blue". No other object colours exist; the room's own surfaces are never red or blue.
- Objects float anywhere inside the room (they do not rest on the floor). "size" is the sphere diameter or the cube edge length, always exactly one of: ${sizes}. Cubes have arbitrary orientation.
- "position" is the object's centre [x, y, z]; each coordinate is a multiple of ${GRID}. Objects never overlap or touch each other or the walls. Objects cast soft shadows; shadows are not objects.
- Because nothing marks which corner of the room is the origin, you may use any of the room's symmetric frames, but you MUST express both cameras and all objects in the SAME frame. The sandbox's align() does this.

## What the photographs look like
The cameras are outside the room, so each image shows the room as an open box against a black background: the interior faces facing the camera are drawn, the near faces are not. The outline of the room is a hexagon whose vertices are corners of the cube; the room's own corners are what the sandbox uses to calibrate each camera.

## The sandbox
It contains camera_A.jpg, camera_B.jpg and the helper module worldsim.py. Start EVERY session with exactly this bootstrap cell:

\`\`\`python
${BOOTSTRAP_SNIPPET}
help(ws)  # read the API once
\`\`\`

worldsim API (pixel coordinates are (u, v) with (0,0) top-left; an "objects" list is a list of dicts in the output format below; cubes may carry a "rotation" used only for rendering):
- ws.room_outline(cam) -> the 6 pixel corners of the room's outline (verify them against the image; ws.set_room_outline(cam, corners) overrides them).
- ws.solve_camera(cam) -> Pose: camera position, focal length and reprojection error, recovered from the outline and the unit-cube geometry. A reprojection error above a few pixels means the outline is wrong.
- ws.align(poseA, poseB) -> poseB re-expressed in camera A's frame (it scores all 48 candidate frames by matching the colours of faces visible in both images and by how well same-colour blobs triangulate). It warns when ambiguous.
- ws.blobs(cam) -> red/blue regions with area, bbox, width, height, centroid, circularity, touches_edge, printed left to right. Two touching same-colour objects merge into ONE blob; an object may be hidden behind another in one view.
- ws.auto_match(poseA, poseB, blobsA, blobsB) -> pairs of blobs across the views whose rays intersect (with the 3D point and the ray gap); it reports unpaired blobs.
- ws.initial_hypothesis(poseA, poseB, matches, shapes) -> one object per pair, using the shapes YOU identified (same order as matches): triangulated position, size from the apparent width.
- ws.object_from_pixels(poseA, (u,v), poseB, (u,v), shape, color, width_px_a=...) -> one object from pixel centres you read off the images yourself; use it for objects merged into a shared blob, partly hidden, or missed by blobs().
- ws.triangulate(poseA, (u,v), poseB, (u,v)) -> 3D point and ray gap; poseX.project([x,y,z]) -> pixel.
- ws.compare(objects, poseA, poseB) -> renders the hypothesis in both cameras and compares with the real images: mean IoU (1.0 perfect; a correct answer typically scores 0.8-0.95), per-object pixel offsets (du, dv) and width ratios, phantom objects and UNEXPLAINED real blobs.
- ws.shape_test(objects, poseA, poseB, i) -> IoU with object i as a sphere vs as a cube.
- ws.local_search(objects, poseA, poseB) -> coordinate descent over positions, sizes and cube rotations to maximise IoU. It never changes shapes, colours or the object count; those are yours.
- ws.snap(objects), ws.to_json(objects) -> final formatting (grid positions, legal sizes, no rotations).

## Method (follow it in order; do not skip the verification)
1. LOOK at both images (attached to this message and in the sandbox). Count the objects; note the colour and shape of each (a sphere has a round silhouette with a soft highlight; a cube has straight edges and flat faces, at any orientation). Objects may overlap or hide one another in one view: reconcile the count across both views. This visual inventory is the one thing the sandbox cannot do well - get it right, and remember it when a blob turns out to be two objects.
2. CALIBRATE: ws.room_outline for both cameras (sanity-check the corners against the images), ws.solve_camera for both, then poseB = ws.align(poseA, poseB). Check the reprojection errors and the alignment message.
3. MEASURE: ws.blobs for both cameras, then ws.auto_match. Map blobs to your inventory; unpaired or oversized blobs usually mean merged or hidden objects.
4. HYPOTHESISE: ws.initial_hypothesis for the matched pairs with your shapes; add any merged/hidden object with ws.object_from_pixels using centres you read off the images.
5. CHECK: ws.compare(objects, poseA, poseB). Read every line: large offsets or width ratios far from 1.0 mean a wrong object; UNEXPLAINED blobs mean missing objects or wrong colours; phantoms mean extra objects. Use ws.shape_test for doubtful shapes.
6. RE-GUESS: fix what the check revealed, run ws.local_search, then ws.compare again. Repeat 5-6 until the score stops improving and every object has small offsets in BOTH cameras. Typically 2-4 iterations. Do NOT write brute-force searches over several objects at once (each compare takes ~0.1 s); ws.local_search plus targeted single-object trials is the intended tool. A final IoU of 0.8-0.95 is normal for a perfect answer; IoU is for comparing hypotheses, not a target to push to 1.0.
7. OUTPUT the final ws.snap(objects) as JSON (positions on the 0.05 grid, no rotations).

## Output
Return JSON with exactly these keys:
{
  "notes": "<inventory, calibration results, blob-to-object mapping, what each check revealed and what you changed, final compare score>",
  "objects": [
    { "shape": "sphere" | "cube", "color": "red" | "blue", "size": 0.10 | 0.15 | 0.20, "position": [x, y, z] }
  ]
}
Never return an empty objects list. Do not include any object you cannot see in at least one image.`;
}

export function buildUserText(): string {
  return "Image 1 is the photograph from camera A. Image 2 is the photograph from camera B. The same files are in your sandbox. Reconstruct the room: run the full method, including calibration and the render-and-compare verification loop, before answering.";
}

/** JSON schema for structured output. Key order matters: notes first, so the model summarises its work before answering. */
export const GUESS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    notes: { type: "string" },
    objects: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          shape: { type: "string", enum: ["sphere", "cube"] },
          color: { type: "string", enum: ["red", "blue"] },
          size: { type: "number" },
          position: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
        },
        required: ["shape", "color", "size", "position"],
      },
    },
  },
  required: ["notes", "objects"],
} as const;
