import { makeRng } from "./rng";
import type { CameraSpec, Room, RoomObject, Shape, ObjColor, Vec3 } from "./types";

export const ROOM_SIZE = 1;
export const SIZES = [0.1, 0.15, 0.2] as const;
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
 * Objects rest on the floor, so y = size / 2.
 */
export function generateRoom(seed = Math.floor(Math.random() * 2 ** 31)): Room {
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

  const lighting = {
    ambientIntensity: r3(rng.range(0.35, 0.7)),
    keyLight: {
      position: [r3(rng.range(0.15, 0.85)), r3(rng.range(0.8, 0.98)), r3(rng.range(0.15, 0.85))] as Vec3,
      intensity: r3(rng.range(0.8, 1.6)),
      color: hsl(rng.range(30, 60), rng.range(0, 0.3), rng.range(0.85, 1)),
    },
    fillLight: {
      position: [r3(rng.range(0, 1)), r3(rng.range(0.5, 0.95)), r3(rng.range(0, 1))] as Vec3,
      intensity: r3(rng.range(0.2, 0.6)),
      color: hsl(rng.range(180, 240), rng.range(0, 0.25), rng.range(0.85, 1)),
    },
  };

  // Objects
  const count = rng.int(2, 5);
  const objects: RoomObject[] = [];
  let attempts = 0;
  while (objects.length < count && attempts < 500) {
    attempts++;
    const size = rng.pick(SIZES);
    const half = size / 2;
    const margin = half + 0.05;
    const x = round(rng.range(margin, ROOM_SIZE - margin));
    const z = round(rng.range(margin, ROOM_SIZE - margin));
    const candidate: RoomObject = {
      id: objects.length + 1,
      shape: rng.pick(["sphere", "cube"] as const) as Shape,
      color: rng.pick(["red", "blue"] as const) as ObjColor,
      size,
      position: [r3(x), r3(half), r3(z)],
    };
    const overlaps = objects.some((o) => {
      const dx = o.position[0] - candidate.position[0];
      const dz = o.position[2] - candidate.position[2];
      const minDist = o.size / 2 + half + 0.06;
      return Math.hypot(dx, dz) < minDist;
    });
    if (!overlaps) objects.push(candidate);
  }

  // Cameras: mounted high on two different walls, looking toward the room.
  const walls = ["N", "S", "E", "W"] as const;
  const wallA = rng.pick(walls);
  let wallB = rng.pick(walls);
  while (wallB === wallA) wallB = rng.pick(walls);

  const makeCamera = (id: "A" | "B", wall: (typeof walls)[number]): CameraSpec => {
    const along = rng.range(0.15, 0.85);
    const height = rng.range(0.7, 0.95);
    const inset = 0.02;
    let position: Vec3;
    if (wall === "N") position = [along, height, inset];
    else if (wall === "S") position = [along, height, ROOM_SIZE - inset];
    else if (wall === "W") position = [inset, height, along];
    else position = [ROOM_SIZE - inset, height, along];
    const lookAt: Vec3 = [r3(rng.range(0.35, 0.65)), r3(rng.range(0.05, 0.25)), r3(rng.range(0.35, 0.65))];
    return {
      id,
      position: position.map(r3) as Vec3,
      lookAt,
      fov: Math.round(rng.range(62, 78)),
      aspect: ASPECT,
    };
  };

  return {
    size: ROOM_SIZE,
    colors,
    lighting,
    cameras: [makeCamera("A", wallA), makeCamera("B", wallB)],
    objects,
    seed,
  };
}

/** Ground-truth objects without their internal ids (the shape the model must reproduce). */
export function stripIds(objects: RoomObject[]) {
  return objects.map((o) => ({ shape: o.shape, color: o.color, size: o.size, position: o.position }));
}
