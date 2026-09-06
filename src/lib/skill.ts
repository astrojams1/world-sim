import { GRID, PLATFORM_MAX_OBJECTS, PLATFORM_MAX_TILT, PLATFORM_SIZE, PLATFORM_SPEED, SIZES, SNAPSHOT_INTERVAL } from "./room";
import type { Mode } from "./types";

/**
 * The "skill" given to the cheap vision model.
 *
 * The model receives ONLY: the unaltered camera images (two in static mode, four in platform mode), the fact that
 * the room is a 1 x 1 x 1 cube seen from two viewpoints, the generator's rules for the mode, and the task (the
 * output JSON). No camera calibration and no surface colours are passed. The model gets a Python sandbox
 * containing the images and worldsim.py (src/lib/sandbox/worldsim.py), whose tools derive everything else from
 * the images: it finds the room's outline, solves each camera's pose and focal length from the known unit cube,
 * triangulates objects, and renders/compares hypotheses so the model can run its guess -> check -> re-guess loop
 * inside one response. In platform mode the same tools run under a "resting on the platform" constraint, the
 * platform itself is fitted to its green silhouette, and the second snapshots give the velocity.
 */

export const SANDBOX_FILES = {
  helper: "worldsim.py",
  A: "camera_A.jpg",
  B: "camera_B.jpg",
  A2: "camera_A2.jpg",
  B2: "camera_B2.jpg",
} as const;

export type ImageId = "A" | "B" | "A2" | "B2";

/** The images a mode sends (as message images and as sandbox files), in order. */
export function imageIdsForMode(mode: Mode): ImageId[] {
  return mode === "platform" ? ["A", "B", "A2", "B2"] : ["A", "B"];
}

export const SESSION_LOG = "session_log.txt";

export const BOOTSTRAP_SNIPPET = `import os, shutil, sys
for f in os.listdir('/mnt/data'):
    for name in ('worldsim.py', 'camera_A.jpg', 'camera_B.jpg', 'camera_A2.jpg', 'camera_B2.jpg'):
        if f.endswith(name) and f != name:
            shutil.copy(os.path.join('/mnt/data', f), os.path.join('/mnt/data', name))
sys.path.insert(0, '/mnt/data')
import worldsim as ws`;

const sizes = () => SIZES.map((s) => s.toFixed(2)).join(", ");

/** The rules platform mode shares with static mode (whose prompt is kept verbatim as the benchmark record's). */
function commonRules(): string {
  return `- The room is a cube, 1.0 x 1.0 x 1.0 units. Coordinates are in [0, 1] along x, y (up) and z. The photographs are views of the same room from two different, unknown camera positions outside the room. Nothing else about the cameras is known.
- Every object is either a "sphere" or a "cube", and is either pure "red" or pure "blue". No other object colours exist; the room's own surfaces are never red or blue.
- "size" is the sphere diameter or the cube edge length, always exactly one of: ${sizes()}.
- A cube's "rotation" is its orientation as Euler angles [rx, ry, rz] in radians, XYZ order (rotation matrix = Rx * Ry * Rz applied to the axis-aligned cube). Any of the 24 orientations that map the cube onto itself is equally correct. Spheres have no rotation (null).
- Objects cast soft shadows; shadows are not objects.
- Because nothing marks which corner of the room is the origin, you may use any of the room's symmetric frames, but you MUST express both cameras and everything you report in the SAME frame. The sandbox's align() does this.`;
}

function commonSandbox(): string {
  return `Do not print help(ws) or the module source: long outputs get truncated and you lose the report you need. If a cell's output comes back empty or cut off, re-run just that call in its own cell.

worldsim API (pixel coordinates are (u, v) with (0,0) top-left; an "objects" list is a list of dicts in the output format below):`;
}

function commonLowLevelApi(): string {
  return `- ws.room_outline(cam) -> the 6 pixel corners of the room's outline (verify them against the image; ws.set_room_outline(cam, corners) overrides them).
- ws.solve_camera(cam) -> Pose: camera position, focal length and reprojection error, recovered from the outline and the unit-cube geometry. A reprojection error above a few pixels means the outline is wrong.
- ws.align(poseA, poseB) -> poseB re-expressed in camera A's frame (it scores all 48 candidate frames by matching the colours of faces visible in both images and by how well same-colour blobs triangulate). It warns when ambiguous.
- ws.blobs(cam) -> red/blue regions with area, bbox, width, height, centroid, circularity, touches_edge, printed left to right. Two touching same-colour objects merge into ONE blob; an object may be hidden behind another in one view.
- ws.auto_match(poseA, poseB, blobsA, blobsB) -> pairs of blobs across the views whose rays intersect (with the 3D point and the ray gap); it reports unpaired blobs.
- ws.initial_hypothesis(poseA, poseB, matches, shapes) -> one object per pair, using the shapes YOU identified (same order as matches): triangulated position, size from the apparent width.
- ws.object_from_pixels(poseA, (u,v), poseB, (u,v), shape, color, width_px_a=...) -> one object from pixel centres you read off the images yourself; use it for objects merged into a shared blob, partly hidden, or missed by blobs().
- ws.triangulate(poseA, (u,v), poseB, (u,v)) -> 3D point and ray gap; poseX.project([x,y,z]) -> pixel.
- ws.compare(objects, poseA, poseB) -> renders the hypothesis in both cameras and compares with the real images: mean IoU (1.0 perfect; a correct answer typically scores 0.8-0.95), per-object pixel offsets (du, dv) and width ratios, phantom objects and UNEXPLAINED real blobs.
- ws.shape_check(objects, poseA, poseB) -> tests EVERY object as a sphere and as a rotation-fitted cube against both images and returns the recommended shapes; ws.apply_shapes(objects, shapes) applies them. ws.shape_test(objects, poseA, poseB, i) does one object.
- ws.local_search(objects, poseA, poseB) -> coordinate descent over positions, sizes and cube rotations to maximise IoU. It never changes shapes, colours or the object count; those are yours. ws.refine_all_rotations(objects, poseA, poseB) polishes every cube's orientation against its own silhouette (orientation is scored to about 10 degrees); run it once at the end.`;
}

function reconcileRules(): string {
  return `   - An object missing from the list (merged into a shared blob, or hidden in one view): add it with ws.object_from_pixels using centres you read off the images. A blob much wider than its object, or an UNEXPLAINED blob, is the tell-tale.
   - An AUTO-ADDED object you cannot see in either image, or a duplicate: remove it. But never let the object count drop below the number you counted in step 1: an object that exists but is mispositioned (even one flagged as a phantom in one view) scores far better than a missing one, so keep it.
   - A wrong colour: fix it.
   - Shapes: the shape verdicts are final. They combine the silhouettes in both views with the shading inside each blob (flat faces with sharp edges vs one smooth gradient), which beats the eye on small objects. Never change a cube verdict to sphere. You may change a sphere verdict to cube only if you clearly see straight edges and flat faces in BOTH images.
   - Never type or edit a position, size or rotation yourself; the tools fit those far better than eyes can.`;
}

function staticPrompt(): string {
  return `You are a precise 3D scene-reconstruction system. You receive two photographs of a room, taken from two different unknown viewpoints, and must reconstruct the exact scene description as JSON. You are scored on exact agreement with the ground truth, so precision matters more than speed. You have a Python sandbox; use it to measure, to calibrate the cameras, to render your hypothesis, and to compare it against the photographs. Never guess a number you could measure.

## What you know (and nothing more)
- The room is a cube, 1.0 x 1.0 x 1.0 units. Coordinates are in [0, 1] along x, y (up) and z. The two photographs are two views of the same room from two different, unknown camera positions outside the room. Nothing else about the cameras is known.
- It contains between 2 and 12 objects. Every object is either a "sphere" or a "cube", and is either pure "red" or pure "blue". No other object colours exist; the room's own surfaces are never red or blue.
- Objects float anywhere inside the room (they do not rest on the floor). "size" is the sphere diameter or the cube edge length, always exactly one of: ${sizes()}. Cubes have arbitrary orientation.
- "position" is the object's centre [x, y, z]; each coordinate is a multiple of ${GRID}. Objects never overlap or touch each other or the walls. Objects cast soft shadows; shadows are not objects.
- A cube's "rotation" is its orientation as Euler angles [rx, ry, rz] in radians, XYZ order (rotation matrix = Rx * Ry * Rz applied to the axis-aligned cube). Any of the 24 orientations that map the cube onto itself is equally correct. Spheres have no rotation (null).
- Because nothing marks which corner of the room is the origin, you may use any of the room's symmetric frames, but you MUST express both cameras and all objects in the SAME frame. The sandbox's align() does this.

## What the photographs look like
The cameras are outside the room, so each image shows the room as an open box against a black background: the interior faces facing the camera are drawn, the near faces are not. The outline of the room is a hexagon whose vertices are corners of the cube; the room's own corners are what the sandbox uses to calibrate each camera.

## The sandbox
It contains camera_A.jpg, camera_B.jpg and the helper module worldsim.py. Start EVERY session with exactly this bootstrap, as the first lines of your first cell:

\`\`\`python
${BOOTSTRAP_SNIPPET}
\`\`\`
${commonSandbox()}
- ws.solve_all(shapes=None) -> runs the whole pipeline below in one call and prints everything; returns {pose_a, pose_b, blobs_a, blobs_b, matches, objects, report}. Pass shapes=[...] (one per printed match, in order) only if you already know them.
- ws.finish(objects, poseA, poseB) -> refine positions, sizes and rotations, verify, print the answer JSON.
Lower-level tools, for reconciling:
${commonLowLevelApi()}
- ws.snap(objects), ws.to_json(objects) -> final formatting (grid positions, legal sizes, cube rotations as fitted, null for spheres).

## Method (follow it in order; one code cell is the normal case, at most 6 in total)
1. LOOK at both images (attached to this message and in the sandbox). Count the objects; note the colour of each and whether two same-colour objects touch or overlap in either view. Objects may hide one another in one view: reconcile the count across both views. Colour and count are what your eyes are for; shape is decided by silhouettes (step 3).
2. SOLVE in ONE cell: the bootstrap, then r = ws.solve_all(); objects = r["objects"]; poseA, poseB = r["pose_a"], r["pose_b"]. It calibrates both cameras from the room outline, aligns their frames, detects and pairs the blobs, builds a hypothesis, explains any unpaired blob by searching along its ray (printed as AUTO-ADDED), decides sphere vs cube from the silhouettes, refines positions/sizes/rotations, prints a compare report and the answer JSON under a banner. Read the whole printout. If the banner says FINAL ANSWER and the object count and colours match your inventory from step 1, you are done: go straight to step 5 without running another cell.
3. RECONCILE the printout with your inventory, touching only what your eyes can judge better than the silhouettes:
${reconcileRules()}
4. FINISH (only if you changed something in step 3, or the banner was not FINAL): objects = ws.finish(objects, poseA, poseB) in the same cell as your changes. It refines, re-verifies and prints the answer JSON under a banner. If the banner says FINAL ANSWER, you are done: running any further cell is an error. If it says one open issue remains, fix exactly that one thing in ONE cell, call finish once more, and stop whatever it says. Do not iterate for IoU: a correct answer scores 0.8-0.95 and higher IoU is not the goal. Never write brute-force searches.
5. OUTPUT the JSON printed under the last banner, verbatim: same objects, same numbers. Do not round, snap, reorder or "correct" anything by hand.

## Output
Return JSON with exactly these keys:
{
  "notes": "<at most two short sentences: the objects you counted (colours), anything you changed after solve_all, the final compare score>",
  "objects": [
    { "shape": "sphere" | "cube", "color": "red" | "blue", "size": 0.10 | 0.15 | 0.20, "position": [x, y, z], "rotation": [rx, ry, rz] | null }
  ]
}
"rotation" is required for cubes (radians, XYZ Euler) and null for spheres. Never return an empty objects list. Do not include any object you cannot see in at least one image.`;
}

function platformPrompt(): string {
  const [L, T, W] = PLATFORM_SIZE;
  return `You are a precise 3D scene-reconstruction system. You receive four photographs of a room: two cameras at unknown viewpoints each took two snapshots, ${SNAPSHOT_INTERVAL} s apart, of a moving platform carrying objects. You must reconstruct the exact scene description at the FIRST snapshot as JSON: the platform's position, orientation and velocity, and every object. You are scored on exact agreement with the ground truth, so precision matters more than speed. You have a Python sandbox; use it to measure, to calibrate the cameras, to render your hypothesis, and to compare it against the photographs. Never guess a number you could measure.

## What you know (and nothing more)
${commonRules()}
- The two cameras do not move between their snapshots. Both cameras shot their first snapshot at the same instant (images 1 and 2: camera A, camera B) and their second snapshot exactly ${SNAPSHOT_INTERVAL} s later (images 3 and 4: camera A, camera B).
- The platform is a rigid rectangular slab, pure green, of fixed size: ${L} long, ${W} wide and ${T} thick. Its long axis is its direction of motion. It moves at a constant velocity of ${PLATFORM_SPEED[0]}-${PLATFORM_SPEED[1]} units per second along that axis (either way), so between the snapshots the platform and everything on it move by the same displacement (velocity x ${SNAPSHOT_INTERVAL} s). It can have any orientation: its top face is tilted up to ${PLATFORM_MAX_TILT} degrees from horizontal and its long axis points anywhere in its plane. The room's surfaces are never green.
- It carries between 2 and ${PLATFORM_MAX_OBJECTS} objects, all resting on its top face: gravity acts perpendicular to the platform, so a sphere touches the face and a cube sits flat on one of its own faces (its only freedom is a yaw about the platform's normal). Objects never overlap or touch each other and never overhang the platform's edge. Nothing else is in the room.
- "position" is an object's centre [x, y, z] at the first snapshot, in room coordinates (not on any grid). The platform's "position" is the centre of the slab at the first snapshot, "normal" the unit normal of its top face (pointing from the slab toward the objects), "velocity" its velocity vector in room units per second.

## What the photographs look like
The cameras are outside the room, so each image shows the room as an open box against a black background: the interior faces facing the camera are drawn, the near faces are not. The outline of the room is a hexagon whose vertices are corners of the cube; the room's own corners are what the sandbox uses to calibrate each camera. The green platform and the red/blue objects on it are the only things inside.

## The sandbox
It contains camera_A.jpg, camera_B.jpg (first snapshot), camera_A2.jpg, camera_B2.jpg (second snapshot) and the helper module worldsim.py. Start EVERY session with exactly this bootstrap, as the first lines of your first cell:

\`\`\`python
${BOOTSTRAP_SNIPPET}
\`\`\`
${commonSandbox()}
- ws.solve_platform(shapes=None) -> runs the whole pipeline in one call and prints everything; returns {pose_a, pose_b, platform, objects, report}. It calibrates both cameras from the room outline, aligns their frames, fits the platform to its green silhouette in both first-snapshot images, detects and pairs the object blobs, builds a hypothesis in which every object rests on the platform, explains unpaired blobs (AUTO-ADDED), decides sphere vs cube from the silhouettes, refines positions/sizes/yaws, measures the displacement between the snapshots (hence the velocity), prints a compare report and the answer JSON under a banner.
- ws.finish_platform(objects, platform, poseA, poseB) -> refine, verify, print the answer JSON (objects stay on the platform; the platform and velocity are kept).
- ws.platform_info(platform) -> prints the platform's centre, normal, long axis, velocity and its four top corners projected into each camera, to check against the images.
Lower-level tools, for reconciling (they all respect the platform constraint once solve_platform has run):
${commonLowLevelApi()}
- ws.to_json(objects, platform) -> final formatting (legal sizes, objects snapped onto the platform, cube rotations as fitted, null for spheres).

## Method (follow it in order; one code cell is the normal case, at most 6 in total)
1. LOOK at all four images (attached to this message and in the sandbox). Count the objects on the platform; note the colour of each and whether two same-colour objects touch or overlap in any view. Objects may hide one another in one view: reconcile the count across the views (the second snapshots show the same objects, moved). Colour and count are what your eyes are for; shape is decided by silhouettes (step 3).
2. SOLVE in ONE cell: the bootstrap, then r = ws.solve_platform(); objects, platform = r["objects"], r["platform"]; poseA, poseB = r["pose_a"], r["pose_b"]. Read the whole printout. If the banner says FINAL ANSWER and the object count and colours match your inventory from step 1, you are done: go straight to step 5 without running another cell.
3. RECONCILE the printout with your inventory, touching only what your eyes can judge better than the silhouettes:
${reconcileRules()}
   - Never edit the platform or the velocity by hand; they are measured from the green silhouette and the second snapshots.
4. FINISH (only if you changed something in step 3, or the banner was not FINAL): objects = ws.finish_platform(objects, platform, poseA, poseB) in the same cell as your changes. It refines, re-verifies and prints the answer JSON under a banner. If the banner says FINAL ANSWER, you are done: running any further cell is an error. If it says one open issue remains, fix exactly that one thing in ONE cell, call finish_platform once more, and stop whatever it says. Do not iterate for IoU. Never write brute-force searches.
5. OUTPUT the JSON printed under the last banner, verbatim: same platform, same objects, same numbers. Do not round, reorder or "correct" anything by hand.

## Output
Return JSON with exactly these keys:
{
  "notes": "<at most two short sentences: the objects you counted (colours), anything you changed after solve_platform, the final compare score>",
  "platform": { "position": [x, y, z], "normal": [nx, ny, nz], "velocity": [vx, vy, vz] },
  "objects": [
    { "shape": "sphere" | "cube", "color": "red" | "blue", "size": 0.10 | 0.15 | 0.20, "position": [x, y, z], "rotation": [rx, ry, rz] | null }
  ]
}
"rotation" is required for cubes (radians, XYZ Euler) and null for spheres. Never return an empty objects list. Do not include any object you cannot see in at least one image.`;
}

/** The system prompt is a function of the mode only: no room data can flow in. */
export function buildSystemPrompt(mode: Mode = "static"): string {
  return mode === "platform" ? platformPrompt() : staticPrompt();
}

export function buildUserText(mode: Mode = "static"): string {
  if (mode === "platform") {
    return `Images 1 and 2 are the first snapshots from camera A and camera B; images 3 and 4 are the second snapshots from camera A and camera B, ${SNAPSHOT_INTERVAL} s later. The same files are in your sandbox. Reconstruct the platform and its objects at the first snapshot: run the full method, including calibration and the render-and-compare verification loop, before answering.`;
  }
  return "Image 1 is the photograph from camera A. Image 2 is the photograph from camera B. The same files are in your sandbox. Reconstruct the room: run the full method, including calibration and the render-and-compare verification loop, before answering.";
}

const OBJECT_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    properties: {
      shape: { type: "string", enum: ["sphere", "cube"] },
      color: { type: "string", enum: ["red", "blue"] },
      size: { type: "number" },
      position: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
      rotation: { type: ["array", "null"], items: { type: "number" }, minItems: 3, maxItems: 3 },
    },
    required: ["shape", "color", "size", "position", "rotation"],
  },
} as const;

const VEC3_SCHEMA = { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 } as const;

/** JSON schema for structured output. Key order matters: notes first, so the model summarises its work before answering. */
export const GUESS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    notes: { type: "string" },
    objects: OBJECT_SCHEMA,
  },
  required: ["notes", "objects"],
} as const;

export const PLATFORM_GUESS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    notes: { type: "string" },
    platform: {
      type: "object",
      additionalProperties: false,
      properties: { position: VEC3_SCHEMA, normal: VEC3_SCHEMA, velocity: VEC3_SCHEMA },
      required: ["position", "normal", "velocity"],
    },
    objects: OBJECT_SCHEMA,
  },
  required: ["notes", "platform", "objects"],
} as const;

export function guessSchema(mode: Mode) {
  return mode === "platform" ? PLATFORM_GUESS_SCHEMA : GUESS_SCHEMA;
}
