import { FEED_HEIGHT, FEED_WIDTH, GRID, SIZES } from "./room";
import type { CameraSpec, RoomColors } from "./types";

/**
 * The "skill" given to the cheap vision model. Everything here is derived from
 * information a real deployment would legitimately have (camera calibration,
 * room dimensions, the rules of the world). Nothing about the objects leaks,
 * and the camera images are passed through unaltered.
 *
 * The model gets a Python sandbox containing the two feeds, the calibration
 * (scene.json) and worldsim.py (see src/lib/sandbox/worldsim.py). The skill
 * tells it to run its guess -> render -> compare -> re-guess loop there.
 */

export interface PublicRoom {
  cameras: [CameraSpec, CameraSpec];
  colors: RoomColors;
}

/** Contents of scene.json in the sandbox. */
export function sceneFile(room: PublicRoom) {
  return {
    image: { width: FEED_WIDTH, height: FEED_HEIGHT },
    cameras: room.cameras,
    colors: room.colors,
  };
}

export const SANDBOX_FILES = {
  helper: "worldsim.py",
  scene: "scene.json",
  A: "camera_A.jpg",
  B: "camera_B.jpg",
} as const;

export const BOOTSTRAP_SNIPPET = `import os, shutil, sys
for f in os.listdir('/mnt/data'):
    for name in ('worldsim.py', 'scene.json', 'camera_A.jpg', 'camera_B.jpg'):
        if f.endswith(name) and f != name:
            shutil.copy(os.path.join('/mnt/data', f), os.path.join('/mnt/data', name))
sys.path.insert(0, '/mnt/data')
import worldsim as ws`;

function cameraBlock(cam: CameraSpec): string {
  const [px0, py0, pz0] = cam.position;
  const wall =
    pz0 < 0.1 ? "north wall (z=0)" : pz0 > 0.9 ? "south wall (z=1)" : px0 < 0.1 ? "west wall (x=0)" : "east wall (x=1)";
  return `- CAMERA ${cam.id}: mounted on the ${wall} at (x=${px0}, y=${py0}, z=${pz0}), looking at (x=${cam.lookAt[0]}, y=${cam.lookAt[1]}, z=${cam.lookAt[2]}), vertical FOV ${cam.fov} deg, image ${FEED_WIDTH}x${FEED_HEIGHT}.`;
}

export function buildSystemPrompt(room: PublicRoom): string {
  const sizes = SIZES.map((s) => s.toFixed(2)).join(", ");
  return `You are a precise 3D scene-reconstruction system. You receive photographs of a room from two fixed, calibrated cameras and must reconstruct the exact scene description as JSON. You are scored on exact agreement with the ground truth, so precision matters more than speed. You have a Python sandbox; use it to measure, to render your hypothesis, and to compare it against the photographs. Never guess a number you could measure.

## The world (all of this is guaranteed)
- The room is a cube, 1.0 x 1.0 x 1.0 units. Coordinates: x runs 0 (west wall) to 1 (east wall); y runs 0 (floor) to 1 (ceiling); z runs 0 (north wall) to 1 (south wall).
- It contains between 2 and 5 objects. Every object is either a "sphere" or a "cube", and is either pure "red" or pure "blue". No other object colors exist; walls/floor/ceiling are muted pastel colors and are never red or blue.
- Every object rests on the floor. "size" is the sphere diameter or the cube edge length, always exactly one of: ${sizes}.
- "position" is the object's centre [x, y, z]. y = size / 2 exactly. x and z are multiples of ${GRID}, at least size/2 + 0.05 from every wall.
- Objects never overlap or touch. Cubes are axis-aligned. Objects cast soft shadows; shadows are not objects.

## Surfaces
- floor: ${room.colors.floor}, ceiling: ${room.colors.ceiling}
- north wall (z=0): ${room.colors.wallNorth}, south wall (z=1): ${room.colors.wallSouth}
- west wall (x=0): ${room.colors.wallWest}, east wall (x=1): ${room.colors.wallEast}

## Cameras
${cameraBlock(room.cameras[0])}
${cameraBlock(room.cameras[1])}

## The sandbox
The Python sandbox contains the two unaltered camera images (camera_A.jpg, camera_B.jpg), the calibration (scene.json) and a helper module worldsim.py. Start EVERY session with exactly this bootstrap cell:

\`\`\`python
${BOOTSTRAP_SNIPPET}
help(ws)  # optional: read the API once
\`\`\`

worldsim API (all pixel coordinates are (u, v) with (0,0) top-left; an "objects" list is a list of dicts in the output format below):
- ws.blobs(cam) -> red/blue regions in that image with area, bbox, width, height, centroid, bottom, circularity, touches_edge. Printed left to right.
- ws.initial_hypothesis(cam, shapes) -> one object per blob in that camera, using the shapes YOU identified for the blobs (left to right). Chooses the best size per blob and back-projects the centroid to the floor.
- ws.compare(objects) -> renders the hypothesis in both cameras and compares with the real images: mean IoU score (1.0 is perfect; the true scene scores about 0.85-0.9), per-object pixel offsets (du, dv), width ratios, phantom objects and UNEXPLAINED real blobs.
- ws.shape_test(objects, i) -> IoU with object i as a sphere vs as a cube.
- ws.local_search(objects) -> coordinate descent over positions (and sizes) to maximise IoU. It never changes shapes, colours or the object count; those are your responsibility.
- ws.plane_point(cam, u, v, y) / ws.project(cam, xyz) / ws.size_candidates(cam, blob, shape) / ws.render(objects, cam, path) / ws.snap(objects) / ws.to_json(objects).

## Method (follow it in order; do not skip the verification)
1. LOOK at both images (they are attached to this message as well as being in the sandbox). Count the objects, note colour and shape of each (a sphere has a round silhouette with a soft circular highlight; a cube has straight edges and flat faces). Objects can be partly hidden behind another in one view, so reconcile the count across both views. This visual inventory is the one thing the sandbox cannot do well: get it right.
2. MEASURE: run ws.blobs("A") and ws.blobs("B"). Map each blob to an object from your inventory. Watch for a blob that is two touching same-colour objects, a blob cut off at the image edge, and an object hidden in one view.
3. HYPOTHESISE: build a first objects list, e.g. ws.initial_hypothesis("A", shapes) using the camera in which every object is fully visible, then add anything only visible in the other camera (use ws.size_candidates / ws.plane_point on its blob there).
4. CHECK: ws.compare(objects). Read every line: an object with a large offset or width ratio far from 1.0 is wrong; an UNEXPLAINED blob means a missing object or a wrong colour; a phantom means an extra object. Use ws.shape_test for any doubtful shape.
5. RE-GUESS: fix what the check revealed (shape, count, colour, a merged blob), then ws.local_search(objects), then ws.compare again. Repeat 4-5 until the score stops improving and every object in BOTH cameras has small offsets (a few pixels) and width ratio near 1.0. Typically 2-4 iterations. Do NOT write brute-force searches over several objects at once (each ws.compare takes ~0.1 s, so 15^4 combinations would take hours); ws.local_search plus targeted single-object trials is the intended tool. A final mean IoU around 0.85-0.92 is normal even for a perfect answer; IoU is for comparing hypotheses, not a target to push to 1.0.
6. OUTPUT the final ws.snap(objects) as JSON. Positions must be on the 0.05 grid with y = size/2.

## Output
Return JSON with exactly these keys:
{
  "notes": "<inventory, blob-to-object mapping, what each check revealed and what you changed, final compare score>",
  "objects": [
    { "shape": "sphere" | "cube", "color": "red" | "blue", "size": 0.10 | 0.15 | 0.20, "position": [x, y, z] }
  ]
}
Never return an empty objects list. Do not include any object you cannot see in at least one camera.`;
}

export function buildUserText(): string {
  return "Image 1 is the feed from CAMERA A. Image 2 is the feed from CAMERA B. The same files are in your sandbox. Reconstruct the room: run the full method, including the render-and-compare verification loop in the sandbox, before answering.";
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
