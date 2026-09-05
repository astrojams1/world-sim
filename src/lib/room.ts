import { makeRng } from "./rng";
import type { CameraSpec, Room, RoomObject, Shape, ObjColor, Vec3 } from "./types";

export const ROOM_SIZE = 1;
export const SIZES = [0.1, 0.15, 0.2] as const;
/** Object count range: a room draws 2-5 objects by default; an explicit count may go up to MAX_OBJECTS. */
export const MIN_OBJECTS = 2;
export const MAX_OBJECTS = 12;
export const GRID = 0.05; // positions are quantized to this step
export const FEED_WIDTH = 640;
export const FEED_HEIGHT = 480;
export const ASPECT = FEED_WIDTH / FEED_HEIGHT;

export const OBJECT_HEX: Record<ObjColor, string> = { red: "#d62828", blue: "#1f5fd6" };

function round(v: number, step = GRID) {
  return Math.round(v / step) * step;
}
function r3(v: number) {
  return Math.round(v * 1000) / 1000;
}

function hsl(h: number, s: number, l: number) {
  // hsl -> hex
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] = [0, 0, 0];
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Generate a random 1x1x1 room. Coordinate system:
 *   x: 0 (west wall) -> 1 (east wall)
 *   y: 0 (floor)     -> 1 (ceiling)
 *   z: 0 (north wall)-> 1 (south wall)
 * Objects float anywhere inside the room; cubes are randomly rotated.
 *
 * `objectCount` (optional, 2..MAX_OBJECTS) fixes the number of objects instead of drawing 2-5; the same seed with
 * no count reproduces the historical rooms exactly (the count is drawn from the stream either way).
 */
export function generateRoom(seed = Math.floor(Math.random() * 2 ** 31), objectCount?: number): Room {
  const rng = makeRng(seed);

  // Surfaces: muted, distinguishable from the saturated red/blue objects.
  const surfaceColor = () => {
    let h = rng.range(0, 360);
    // avoid strongly red or blue hues so objects stay distinguishable
    if (h < 25 || h > 335) h = 40 + rng.range(0, 20);
    if (h > 205 && h < 260) h = 160 + rng.range(0, 40);
    return hsl(h, rng.range(0.15, 0.45), rng.range(0.45, 0.8));
  };
  const colors = {
    floor: surfaceColor(),
    ceiling: surfaceColor(),
    wallNorth: surfaceColor(),
    wallSouth: surfaceColor(),
    wallEast: surfaceColor(),
    wallWest: surfaceColor(),
  };

  // One distant shadow-casting light from a random direction above the room, so every shadow falls the same way,
  // plus ambient and a soft fill light above the room.
  const sunAz = rng.range(0, Math.PI * 2);
  const sunEl = (rng.range(25, 60) * Math.PI) / 180;
  const lighting = {
    ambientIntensity: r3(rng.range(0.7, 1.1)),
    sun: {
      direction: [r3(Math.cos(sunEl) * Math.cos(sunAz)), r3(Math.sin(sunEl)), r3(Math.cos(sunEl) * Math.sin(sunAz))] as Vec3,
      intensity: r3(rng.range(2.4, 3.6)),
      color: hsl(rng.range(30, 60), rng.range(0, 0.3), rng.range(0.85, 1)),
    },
    // Soft directional fill (no shadows) from the opposite side, so walls facing away from the sun are still lit.
    fillLight: {
      position: [r3(0.5 - Math.cos(sunAz) * 3), r3(2.0), r3(0.5 - Math.sin(sunAz) * 3)] as Vec3,
      intensity: r3(rng.range(0.8, 1.4)),
      color: hsl(rng.range(180, 240), rng.range(0, 0.25), rng.range(0.85, 1)),
    },
  };

  // Objects: floating anywhere inside the room, on a 0.05 grid, never touching each other or the walls.
  const drawn = rng.int(2, 5);
  const count = objectCount === undefined ? drawn : Math.max(MIN_OBJECTS, Math.min(MAX_OBJECTS, Math.round(objectCount)));
  const objects: RoomObject[] = [];
  let attempts = 0;
  const maxAttempts = objectCount === undefined ? 1000 : 20000;
  while (objects.length < count && attempts < maxAttempts) {
    attempts++;
    const size = rng.pick(SIZES);
    const half = size / 2;
    // A rotated cube's bounding radius is half*sqrt(3); keep every object at least 0.05 from the walls.
    const shape = rng.pick(["sphere", "cube"] as const) as Shape;
    const reach = shape === "cube" ? half * Math.sqrt(3) : half;
    const margin = reach + 0.05;
    const x = round(rng.range(margin, ROOM_SIZE - margin));
    const y = round(rng.range(margin, ROOM_SIZE - margin));
    const z = round(rng.range(margin, ROOM_SIZE - margin));
    const candidate: RoomObject = {
      id: objects.length + 1,
      shape,
      color: rng.pick(["red", "blue"] as const) as ObjColor,
      size,
      position: [r3(x), r3(y), r3(z)],
      ...(shape === "cube"
        ? { rotation: [r3(rng.range(0, Math.PI * 2)), r3(rng.range(0, Math.PI * 2)), r3(rng.range(0, Math.PI * 2))] as Vec3 }
        : {}),
    };
    const overlaps = objects.some((o) => {
      const d = Math.hypot(
        o.position[0] - candidate.position[0],
        o.position[1] - candidate.position[1],
        o.position[2] - candidate.position[2],
      );
      const oReach = o.shape === "cube" ? (o.size / 2) * Math.sqrt(3) : o.size / 2;
      return d < oReach + reach + 0.06;
    });
    if (!overlaps) objects.push(candidate);
  }

  // Cameras: on a virtual sphere outside (and above) the room, looking at roughly its centre.
  // Seen from outside, the renderer culls the near faces, so the feed shows the room as an open box.
  const centre: Vec3 = [0.5, 0.5, 0.5];
  const makeCamera = (id: "A" | "B", azimuth: number): CameraSpec => {
    const radius = rng.range(1.7, 2.6);
    // Elevation keeps the camera above the ceiling plane and never directly above the room, so each feed shows
    // the room as an open box with a hexagonal outline (three or four interior faces visible).
    const elevation = (rng.range(25, 60) * Math.PI) / 180;
    const position: Vec3 = [
      centre[0] + radius * Math.cos(elevation) * Math.cos(azimuth),
      centre[1] + radius * Math.sin(elevation),
      centre[2] + radius * Math.cos(elevation) * Math.sin(azimuth),
    ];
    const lookAt: Vec3 = [centre[0] + rng.range(-0.08, 0.08), centre[1] + rng.range(-0.08, 0.08), centre[2] + rng.range(-0.08, 0.08)];
    // Field of view wide enough to contain the whole room (half-diagonal ~0.87) with some slack.
    const fov = Math.round((2 * Math.atan(1.0 / radius) * 180) / Math.PI + rng.range(2, 10));
    return { id, position: position.map(r3) as Vec3, lookAt: lookAt.map(r3) as Vec3, fov, aspect: ASPECT };
  };
  const azA = rng.range(0, Math.PI * 2);
  // Second camera at least 50 degrees away in azimuth so the views are genuinely different.
  const azB = azA + (rng.range(50, 310) * Math.PI) / 180;

  return {
    size: ROOM_SIZE,
    colors,
    lighting,
    cameras: [makeCamera("A", azA), makeCamera("B", azB)],
    objects,
    seed,
    objectCount,
  };
}

/** Ground-truth objects without their internal ids (the shape the model must reproduce). */
export function stripIds(objects: RoomObject[]) {
  return objects.map((o) => ({ shape: o.shape, color: o.color, size: o.size, position: o.position, ...(o.rotation ? { rotation: o.rotation } : {}) }));
}
