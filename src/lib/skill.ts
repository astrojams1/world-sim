import { makeProjector } from "./camera";
import { FEED_HEIGHT, FEED_WIDTH, GRID, SIZES } from "./room";
import type { CameraSpec, Guess, RoomColors, Vec3 } from "./types";

/**
 * The "skill" given to the cheap vision model. Everything here is derived from
 * information a real deployment would legitimately have (camera calibration,
 * room dimensions, the rules of the world). Nothing about the objects leaks.
 */

export interface PublicRoom {
  cameras: [CameraSpec, CameraSpec];
  colors: RoomColors;
}

const px = (u: number, v: number) => `(${Math.round(u * FEED_WIDTH)}, ${Math.round(v * FEED_HEIGHT)})`;

function landmarkTable(cam: CameraSpec): string {
  const proj = makeProjector(cam);
  const rows: string[] = [];
  const steps = [0, 0.2, 0.4, 0.6, 0.8, 1];
  rows.push("Floor points, one row per z, entries are x -> pixel (u, v); '*' marks points outside the frame:");
  for (const z of steps) {
    const cells: string[] = [];
    for (const x of steps) {
      const p = proj.project([x, 0, z]);
      if (!p) {
        cells.push(`x=${x.toFixed(1)}->(behind)`);
        continue;
      }
      const [u, v] = p;
      const inside = u >= 0 && u <= 1 && v >= 0 && v <= 1;
      cells.push(`x=${x.toFixed(1)}->${px(u, v)}${inside ? "" : "*"}`);
    }
    rows.push(`  z=${z.toFixed(1)}: ${cells.join("  ")}`);
  }
  const cornerRows: string[] = [];
  const corners: Array<[string, Vec3]> = [
    ["ceiling corner (0,1,0)", [0, 1, 0]],
    ["ceiling corner (1,1,0)", [1, 1, 0]],
    ["ceiling corner (0,1,1)", [0, 1, 1]],
    ["ceiling corner (1,1,1)", [1, 1, 1]],
  ];
  for (const [name, c] of corners) {
    const p = proj.project(c);
    if (!p) continue;
    const [u, v] = p;
    if (u < -0.3 || u > 1.3 || v < -0.3 || v > 1.3) continue;
    const inside = u >= 0 && u <= 1 && v >= 0 && v <= 1;
    cornerRows.push(`  ${name} -> pixel ${px(u, v)}${inside ? "" : " [outside frame]"}`);
  }
  if (cornerRows.length) rows.push("Ceiling corners:", ...cornerRows);
  // Apparent size hints: how many pixels wide a 0.10 object is at a few depths.
  const sizeHints: string[] = [];
  for (const [x, z] of [
    [0.25, 0.25],
    [0.75, 0.25],
    [0.5, 0.5],
    [0.25, 0.75],
    [0.75, 0.75],
  ] as Array<[number, number]>) {
    const a = proj.project([x - 0.05, 0.05, z]);
    const b = proj.project([x + 0.05, 0.05, z]);
    if (!a || !b) continue;
    const w = Math.abs(b[0] - a[0]) * FEED_WIDTH;
    if (a[0] < -0.3 || a[0] > 1.3) continue;
    sizeHints.push(`a 0.10-wide object centred at (x=${x}, z=${z}) appears about ${Math.round(w)} px wide`);
  }
  return rows.join("\n") + (sizeHints.length ? "\n\nApparent size reference for this camera:\n" + sizeHints.join("\n") : "");
}

function cameraBlock(cam: CameraSpec): string {
  const [px0, py0, pz0] = cam.position;
  const wall =
    pz0 < 0.1 ? "north wall (z=0)" : pz0 > 0.9 ? "south wall (z=1)" : px0 < 0.1 ? "west wall (x=0)" : "east wall (x=1)";
  return [
    `CAMERA ${cam.id}`,
    `  mounted on the ${wall} at position (x=${px0}, y=${py0}, z=${pz0})`,
    `  looking at point (x=${cam.lookAt[0]}, y=${cam.lookAt[1]}, z=${cam.lookAt[2]})`,
    `  vertical field of view ${cam.fov} deg, image ${FEED_WIDTH}x${FEED_HEIGHT} px (pixel (0,0) is top-left)`,
    `  Calibration landmarks (true 3D point -> pixel in this camera's image):`,
    landmarkTable(cam)
      .split("\n")
      .map((l) => "    " + l)
      .join("\n"),
  ].join("\n");
}

export function buildSystemPrompt(room: PublicRoom): string {
  const sizes = SIZES.map((s) => s.toFixed(2)).join(", ");
  return `You are a precise 3D scene-reconstruction system. You receive photographs of a room from two fixed, calibrated cameras and must reconstruct the exact scene description as JSON. You are scored on exact agreement with the ground truth, so precision matters more than speed. Work like a surveyor: measure, cross-check between the two views, and revise until both views are explained.

## The world (all of this is guaranteed)
- The room is a cube, 1.0 x 1.0 x 1.0 units. Coordinates: x runs 0 (west wall) to 1 (east wall); y runs 0 (floor) to 1 (ceiling); z runs 0 (north wall) to 1 (south wall).
- It contains between 2 and 5 objects. Every object is either a "sphere" or a "cube", and is either pure "red" or pure "blue". No other object colors exist; walls/floor/ceiling are muted pastel colors and are never red or blue.
- Every object rests on the floor. Its "size" is the sphere diameter or the cube edge length, and size is always exactly one of: ${sizes}.
- Object "position" is the object's centre: [x, y, z]. Because objects rest on the floor, y = size / 2 exactly (0.05, 0.075 or 0.10). x and z are always multiples of ${GRID} (a 0.05 grid), and are at least size/2 + 0.05 away from every wall.
- Objects never overlap or touch each other.
- Cubes are axis-aligned (their faces are parallel to the walls). Objects cast soft shadows; shadows are not objects.

## Surfaces (to help you tell walls apart)
- floor: ${room.colors.floor}, ceiling: ${room.colors.ceiling}
- north wall (z=0): ${room.colors.wallNorth}, south wall (z=1): ${room.colors.wallSouth}
- west wall (x=0): ${room.colors.wallWest}, east wall (x=1): ${room.colors.wallEast}

## Cameras
${cameraBlock(room.cameras[0])}

${cameraBlock(room.cameras[1])}

## Reading pixel positions
The images are unaltered camera renders: there are no overlays or markers. To convert a pixel to a floor position, find the two calibration rows (z values) whose pixel rows bracket the point, interpolate z, then interpolate x between the bracketing x entries of those rows. Perspective means far rows are compressed: work carefully near the top of the image. Wall/floor edges are visible as colour boundaries and coincide with the z=0.0 / z=1.0 / x=0.0 / x=1.0 rows and columns of the table; use them as anchors.

## Method (follow it in order; do not skip the check step)
1. INVENTORY each image separately. For every object: colour, shape (a sphere has a round silhouette and a soft circular highlight; a cube has straight edges, flat faces and a corner facing you), approximate pixel bounding box, and the pixel of the CONTACT POINT where the object meets the floor (bottom-centre of its footprint, i.e. directly below its centre). List spheres and cubes carefully; objects may be partially hidden behind another object in one view, so count in both views and reconcile.
2. CORRESPOND objects between the two views using colour, shape, relative size and left/right ordering. The two cameras are on different walls, so the left-to-right order will differ; reason about which wall each camera is on. The final object count is the number of distinct physical objects.
3. LOCATE each object on the floor. Read its contact-point pixel against the calibration landmarks: interpolate between the nearest labelled floor points to get (x, z). Do this independently from camera A and from camera B. Two independent estimates should agree to within about 0.05; if they disagree, trust the camera in which the object is nearer / larger, and re-inspect the other. Snap the final x and z to the 0.05 grid.
4. SIZE each object by comparing its pixel width to the "apparent size reference" for that camera at a similar depth: a 0.15 object is 1.5x as wide and a 0.20 object twice as wide as the 0.10 reference. Also rank objects by apparent size in both views; the ranking must be consistent with the sizes you assign. Set y = size / 2.
5. CHECK (guess -> verify -> re-guess). For every object, take your estimated (x, z) and predict where it would appear in EACH image by interpolating from the calibration landmarks. Compare the prediction with the observed contact point. If any prediction is off by more than about half a grid cell, move the estimate and check again. Also verify that the left-to-right ordering and the near/far ordering of the objects in each image are reproduced by your estimates. Iterate until both images are fully consistent with your reconstruction; you will often need 2 or 3 revisions.
6. OUTPUT the final reconstruction as JSON.

## Output
Return JSON with exactly these keys:
{
  "notes": "<your inventory, correspondence, per-object estimates from A and B, and the checks/revisions you made — concise but complete>",
  "objects": [
    { "shape": "sphere" | "cube", "color": "red" | "blue", "size": 0.10 | 0.15 | 0.20, "position": [x, y, z] }
  ]
}
Every object must have position values rounded to 3 decimals, x and z on the 0.05 grid, y = size/2. Do not include any object you cannot see in at least one camera.`;
}

export function buildRound1UserText(): string {
  return "Image 1 is the feed from CAMERA A. Image 2 is the feed from CAMERA B. Reconstruct the room. Run the full method, including the CHECK step, before answering.";
}

export function buildFollowupUserText(room: PublicRoom, previous: Guess): string {
  const projA = makeProjector(room.cameras[0]);
  const projB = makeProjector(room.cameras[1]);
  const lines = previous.objects.map((o, i) => {
    const pa = projA.project(o.position);
    const pb = projB.project(o.position);
    const ca = projA.project([o.position[0], 0, o.position[2]]);
    const cb = projB.project([o.position[0], 0, o.position[2]]);
    const f = (p: [number, number, number] | null) => (p ? px(p[0], p[1]) : "not visible");
    return `  #${i + 1} ${o.color} ${o.shape} size ${o.size} at [${o.position.join(", ")}] -> centre in A ${f(pa)}, contact point in A ${f(ca)}; centre in B ${f(pb)}, contact point in B ${f(cb)}`;
  });
  return `Here is the verification for your previous reconstruction.

Image 1 and Image 2 are the REAL feeds from CAMERA A and CAMERA B again. Image 3 and Image 4 are RENDERS OF YOUR PREVIOUS GUESS from exactly the same cameras (same room, same lighting). Where your guess was right, images 3/4 will look identical to images 1/2 at that object.

Where your previous guess places each object in the images:
${lines.join("\n")}

Compare object by object:
- If an object in your render sits left/right or nearer/farther than the real one, shift its x/z. Use the calibration landmarks to convert the pixel offset into room units (the spacing between adjacent table entries is 0.2 units at that depth).
- If the rendered object is visibly larger or smaller than the real one, change its size to the next value in {0.10, 0.15, 0.20} and remember y = size/2.
- If the real images contain an object that your render lacks (or vice versa), add or remove it.
- If shape or colour differs, fix it.
Then re-run the CHECK step on the revised reconstruction and output the full corrected JSON (all objects, not just the changed ones). If you are confident nothing needs to change, output the same JSON again.

Rules for this round:
- All four images are attached to this message; look at them directly. Measure the real contact-point pixels yourself from images 1 and 2, exactly as you did in the first round.
- Never ask for more information and never return an empty object list. The "objects" array must contain every object in the room (2 to 5 objects).
- Put your measurements and the pixel offsets you found in "notes".`;
}

/** JSON schema for structured output. Key order matters: notes first, so non-reasoning models "think" before answering. */
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
