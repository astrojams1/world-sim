import { makeRng } from "./rng";
import type { CameraSpec, Lighting, Mode, Platform, Room, RoomColors, RoomObject, Shape, ObjColor, Vec3 } from "./types";
import { add, cross, dot, eulerToMatrix, fromColumns, matMul, matVec, matrixToEuler, normalize, round3, scale } from "./vec";

export const ROOM_SIZE = 1;
export const SIZES = [0.1, 0.15, 0.2] as const;
/** Object count range: a static room draws 2-5 objects by default; an explicit count may go up to MAX_OBJECTS. */
export const MIN_OBJECTS = 2;
export const MAX_OBJECTS = 12;
export const GRID = 0.05; // positions are quantized to this step
export const FEED_WIDTH = 640;
export const FEED_HEIGHT = 480;
export const ASPECT = FEED_WIDTH / FEED_HEIGHT;

export const OBJECT_HEX: Record<ObjColor, string> = { red: "#d62828", blue: "#1f5fd6" };

// ----------------------------------------------------------------------------- platform mode constants
/** Slab dimensions [along its long axis (the direction of motion), along its normal (thickness), across]. */
export const PLATFORM_SIZE: Vec3 = [0.6, 0.02, 0.4];
/** The platform is pure green (room surfaces are never red, blue or green in platform mode). */
export const PLATFORM_HEX = "#12b812";
/** Largest tilt of the platform's top face from horizontal, degrees. */
export const PLATFORM_MAX_TILT = 40;
/** Speed range, room units per second. */
export const PLATFORM_SPEED: [number, number] = [0.1, 0.3];
/** Seconds between the two snapshots each camera takes. */
export const SNAPSHOT_INTERVAL = 0.5;
/** Platform rooms draw 2-4 objects by default; an explicit count may go up to PLATFORM_MAX_OBJECTS. */
export const PLATFORM_MAX_OBJECTS = 6;

export function maxObjects(mode: Mode) {
  return mode === "platform" ? PLATFORM_MAX_OBJECTS : MAX_OBJECTS;
}

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

type Rng = ReturnType<typeof makeRng>;

/** Muted surface colours, distinguishable from the saturated red/blue objects (and, in platform mode, from the green platform). */
function drawColors(rng: Rng, mode: Mode): RoomColors {
  const surfaceColor = () => {
    let h = rng.range(0, 360);
    // avoid strongly red or blue hues so objects stay distinguishable
    if (h < 25 || h > 335) h = 40 + rng.range(0, 20);
    if (h > 205 && h < 260) h = 160 + rng.range(0, 40);
    // platform mode: keep the platform's green band for the platform
    if (mode === "platform" && h > 85 && h < 160) h = 25 + rng.range(0, 60);
    return hsl(h, rng.range(0.15, 0.45), rng.range(0.45, 0.8));
  };
  return {
    floor: surfaceColor(),
    ceiling: surfaceColor(),
    wallNorth: surfaceColor(),
    wallSouth: surfaceColor(),
    wallEast: surfaceColor(),
    wallWest: surfaceColor(),
  };
}

/** One distant shadow-casting light from a random direction above the room, plus ambient and a soft fill light. */
function drawLighting(rng: Rng): Lighting {
  const sunAz = rng.range(0, Math.PI * 2);
  const sunEl = (rng.range(25, 60) * Math.PI) / 180;
  return {
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
}

/** Static mode: objects floating anywhere inside the room, on a 0.05 grid, never touching each other or the walls. */
function drawStaticObjects(rng: Rng, count: number, maxAttempts: number): RoomObject[] {
  const objects: RoomObject[] = [];
  let attempts = 0;
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
  return objects;
}

/**
 * The platform's orthonormal frame: d = direction of motion (long axis), n = top-face normal, e = d x n (across).
 * As a rotation matrix (columns d, n, e) it maps the slab's local axes (x long, y up, z across) to the room.
 */
export function platformFrame(p: Platform) {
  const n = normalize(p.normal);
  const d = normalize(p.velocity);
  const e = cross(d, n);
  return { d, n, e, matrix: fromColumns(d, n, e) };
}

/** The eight corners of a box centred at c with rotation R (columns = local axes) and full extents `size`. */
export function boxCorners(c: Vec3, R: ReturnType<typeof fromColumns>, size: Vec3): Vec3[] {
  const out: Vec3[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) out.push(add(c, matVec(R, [(sx * size[0]) / 2, (sy * size[1]) / 2, (sz * size[2]) / 2])));
  return out;
}

/** Room-axis extents ([min, max] per axis) of the platform assembly (slab + objects) at the first snapshot. */
function assemblyExtents(platform: Platform, objects: RoomObject[]): [Vec3, Vec3] {
  const { matrix } = platformFrame(platform);
  const pts: Vec3[] = boxCorners(platform.position, matrix, PLATFORM_SIZE);
  for (const o of objects) {
    if (o.shape === "sphere") {
      const h = o.size / 2;
      pts.push(add(o.position, [h, h, h]), add(o.position, [-h, -h, -h]));
    } else pts.push(...boxCorners(o.position, eulerToMatrix(o.rotation!), [o.size, o.size, o.size]));
  }
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], p[k]);
    hi[k] = Math.max(hi[k], p[k]);
  }
  return [lo, hi];
}

/**
 * Platform mode: a rigid slab of PLATFORM_SIZE at a random orientation (top face tilted at most PLATFORM_MAX_TILT
 * from horizontal, long axis pointing anywhere in that plane), moving at a constant speed along its long axis.
 * Objects rest on the top face (spheres touch it; cubes sit on a face with a random yaw about the normal) on a
 * 0.05 grid of the slab's own coordinates, never touching each other or overhanging the edge. The whole assembly
 * stays at least 0.05 from every wall at both snapshots. Positions and rotations are reported in room coordinates
 * at the first snapshot.
 */
function drawPlatformAssembly(rng: Rng, count: number): { platform: Platform; objects: RoomObject[] } {
  const [L, T, W] = PLATFORM_SIZE;
  for (let attempt = 0; attempt < 2000; attempt++) {
    // orientation: normal from tilt + azimuth, long axis at a random angle in the plane
    const tilt = (rng.range(0, PLATFORM_MAX_TILT) * Math.PI) / 180;
    const az = rng.range(0, Math.PI * 2);
    const n: Vec3 = normalize([Math.sin(tilt) * Math.cos(az), Math.cos(tilt), Math.sin(tilt) * Math.sin(az)]);
    const u1 = normalize(cross(n, [0, 0, 1])); // horizontal-ish in-plane axis (n is never along z: tilt <= 40 deg)
    const u2 = cross(n, u1);
    const phi = rng.range(0, Math.PI * 2);
    const d = normalize(add(scale(u1, Math.cos(phi)), scale(u2, Math.sin(phi))));
    const speed = rng.range(PLATFORM_SPEED[0], PLATFORM_SPEED[1]);
    const velocity = round3(scale(d, speed));
    // objects in slab coordinates (a along d, b along e), centre at the origin for now
    const base: Platform = { position: [0, 0, 0], normal: round3(n), velocity };
    const { d: dd, n: nn, e, matrix } = platformFrame(base);
    const local: Array<{ a: number; b: number; r: number }> = [];
    const objects: RoomObject[] = [];
    let tries = 0;
    while (objects.length < count && tries < 300) {
      tries++;
      const size = rng.pick(SIZES);
      const shape = rng.pick(["sphere", "cube"] as const) as Shape;
      const color = rng.pick(["red", "blue"] as const) as ObjColor;
      const yaw = shape === "cube" ? rng.range(0, Math.PI * 2) : 0;
      const h = size / 2;
      // in-plane half extents of the footprint along d and e (a yawed cube reaches h(|cos|+|sin|))
      const ea = shape === "cube" ? h * (Math.abs(Math.cos(yaw)) + Math.abs(Math.sin(yaw))) : h;
      const eb = ea;
      const r = shape === "cube" ? h * Math.SQRT2 : h; // circumradius of the footprint
      const aMax = L / 2 - ea - 0.02;
      const bMax = W / 2 - eb - 0.02;
      if (aMax < 0 || bMax < 0) continue;
      const a = round(rng.range(-aMax, aMax));
      const b = round(rng.range(-bMax, bMax));
      if (Math.abs(a) > aMax + 1e-9 || Math.abs(b) > bMax + 1e-9) continue;
      if (local.some((o) => Math.hypot(o.a - a, o.b - b) < o.r + r + 0.04)) continue;
      local.push({ a, b, r });
      const centre = add(add(scale(dd, a), scale(e, b)), scale(nn, T / 2 + h));
      const obj: RoomObject = { id: objects.length + 1, shape, color, size, position: centre };
      if (shape === "cube") {
        const cy = Math.cos(yaw), sy = Math.sin(yaw);
        const Ry: ReturnType<typeof fromColumns> = [
          [cy, 0, sy],
          [0, 1, 0],
          [-sy, 0, cy],
        ];
        obj.rotation = matrixToEuler(matMul(matrix, Ry));
      }
      objects.push(obj);
    }
    if (objects.length < count) continue;
    // fit the assembly (at both snapshots) inside the room with a 0.05 margin; choose the centre uniformly
    const [lo, hi] = assemblyExtents(base, objects);
    const disp = scale(velocity, SNAPSHOT_INTERVAL);
    const range: Array<[number, number]> = [0, 1, 2].map((k) => [
      0.05 - Math.min(lo[k], lo[k] + disp[k]) + 0.001,
      0.95 - Math.max(hi[k], hi[k] + disp[k]) - 0.001,
    ]);
    if (range.some(([a, b]) => a > b)) continue;
    const centre = round3([rng.range(...range[0]), rng.range(...range[1]), rng.range(...range[2])]);
    const platform: Platform = { position: centre, normal: base.normal, velocity };
    const placed = objects.map((o) => ({
      ...o,
      position: round3(add(o.position, centre)),
      ...(o.rotation ? { rotation: round3(o.rotation) } : {}),
    }));
    return { platform, objects: placed };
  }
  throw new Error("could not place the platform assembly inside the room");
}

/** Cameras: on a virtual sphere outside (and above) the room, looking at roughly its centre. */
function drawCameras(rng: Rng): [CameraSpec, CameraSpec] {
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
  return [makeCamera("A", azA), makeCamera("B", azB)];
}

/**
 * Generate a random 1x1x1 room. Coordinate system:
 *   x: 0 (west wall) -> 1 (east wall)
 *   y: 0 (floor)     -> 1 (ceiling)
 *   z: 0 (north wall)-> 1 (south wall)
 * Static mode: objects float anywhere inside the room; cubes are randomly rotated. Platform mode: objects rest on
 * a moving platform (see drawPlatformAssembly).
 *
 * `objectCount` (optional) fixes the number of objects instead of the mode's default draw (2-5 static, 2-4
 * platform); the same seed with no count reproduces the historical static rooms exactly (the count is drawn from
 * the stream either way).
 */
export function generateRoom(seed = Math.floor(Math.random() * 2 ** 31), objectCount?: number, mode: Mode = "static"): Room {
  const rng = makeRng(seed);
  const colors = drawColors(rng, mode);
  const lighting = drawLighting(rng);

  const drawn = mode === "platform" ? rng.int(2, 4) : rng.int(2, 5);
  const count = objectCount === undefined ? drawn : Math.max(MIN_OBJECTS, Math.min(maxObjects(mode), Math.round(objectCount)));

  let objects: RoomObject[];
  let platform: Platform | undefined;
  if (mode === "platform") {
    ({ platform, objects } = drawPlatformAssembly(rng, count));
  } else {
    objects = drawStaticObjects(rng, count, objectCount === undefined ? 1000 : 20000);
  }
  const cameras = drawCameras(rng);

  return {
    size: ROOM_SIZE,
    mode,
    colors,
    lighting,
    cameras,
    objects,
    ...(platform ? { platform } : {}),
    seed,
    objectCount,
  };
}

/** Ground-truth objects without their internal ids (the shape the model must reproduce). */
export function stripIds(objects: RoomObject[]) {
  return objects.map((o) => ({ shape: o.shape, color: o.color, size: o.size, position: o.position, ...(o.rotation ? { rotation: o.rotation } : {}) }));
}

/** The ground-truth JSON the model is scored against: the platform (platform mode) and the objects. */
export function groundTruth(room: Room) {
  return { ...(room.platform ? { platform: room.platform } : {}), objects: stripIds(room.objects) };
}

/** Position of an object (or the platform) at time t after the first snapshot. */
export function positionAt(position: Vec3, platform: Platform | undefined, t: number): Vec3 {
  return platform && t ? add(position, scale(platform.velocity, t)) : position;
}

/** Signed distance of a point above the platform's top face (used by the viewer and tests). */
export function heightAbove(p: Vec3, platform: Platform) {
  const { n } = platformFrame(platform);
  return dot(n, [p[0] - platform.position[0], p[1] - platform.position[1], p[2] - platform.position[2]]) - PLATFORM_SIZE[1] / 2;
}
