export type Vec3 = [number, number, number];

export type Shape = "sphere" | "cube";
export type ObjColor = "red" | "blue";

/**
 * Task modes. Every mode shares the room, the cameras, the object vocabulary, the scorer and the sandbox helper.
 *   static:   objects float anywhere in the room; two snapshots (one per camera).
 *   platform: objects rest on a rigid platform (a conveyor belt) that moves at constant velocity within its own
 *             plane; each camera takes two snapshots SNAPSHOT_INTERVAL apart (four images).
 */
export type Mode = "static" | "platform";
export const MODES: readonly Mode[] = ["static", "platform"] as const;

export interface RoomObject {
  id: number;
  shape: Shape;
  color: ObjColor;
  /** Edge length for cubes, diameter for spheres. */
  size: number;
  /** Center of the object, in room coordinates (at the first snapshot in platform mode). */
  position: Vec3;
  /** Euler rotation (radians, XYZ order, matrix = Rx * Ry * Rz) for cubes. Part of the task; scored modulo the cube's symmetries. */
  rotation?: Vec3;
}

/**
 * The moving platform of platform mode: an infinite, featureless, pure-green plane that fills the room where it
 * crosses it. `normal` is the unit normal of the side the objects rest on (gravity acts along -normal),
 * `position` the point of the plane closest to the room's centre (the plane's only observable location), and
 * `velocity` the plane's constant velocity in room units per second, in some direction within the plane. The
 * plane itself looks the same at both snapshots: its motion shows only through the objects riding on it.
 */
export interface Platform {
  position: Vec3;
  normal: Vec3;
  velocity: Vec3;
}

export interface CameraSpec {
  id: "A" | "B";
  /** Cameras sit on a virtual sphere outside the room, looking in. */
  position: Vec3;
  lookAt: Vec3;
  /** Vertical field of view in degrees. */
  fov: number;
  /** Aspect ratio width / height of the rendered feed. */
  aspect: number;
}

export interface Lighting {
  ambientIntensity: number;
  /** A single distant, shadow-casting light (sun-like). `direction` points from the room toward the light. */
  sun: { direction: Vec3; intensity: number; color: string };
  /** A soft, non-shadowing directional fill light from roughly opposite the sun. `position` is where it shines from. */
  fillLight: { position: Vec3; intensity: number; color: string };
}

export interface RoomColors {
  floor: string;
  ceiling: string;
  wallNorth: string;
  wallSouth: string;
  wallEast: string;
  wallWest: string;
}

export interface Room {
  /** Room edge length (always 1). */
  size: number;
  mode: Mode;
  colors: RoomColors;
  lighting: Lighting;
  cameras: [CameraSpec, CameraSpec];
  objects: RoomObject[];
  /** Platform mode only. */
  platform?: Platform;
  seed: number;
  /** Requested object count (undefined = the mode's default draw). Together with the seed and mode it reproduces the room. */
  objectCount?: number;
}

/** The subset of the room the model is asked to reconstruct. */
export interface Guess {
  objects: Array<{ shape: Shape; color: ObjColor; size: number; position: Vec3; rotation?: Vec3 }>;
  /** Platform mode only. */
  platform?: Platform;
}

export interface ScoreObjectDetail {
  truthId: number;
  matched: boolean;
  /** Index into guess.objects when matched. */
  guessIndex?: number;
  shapeOk?: boolean;
  colorOk?: boolean;
  sizeError?: number;
  positionError?: number;
  /** Degrees, cubes only, minimised over the cube's 24 rotational symmetries. */
  orientationError?: number;
  points: number;
}

export interface ScorePlatformDetail {
  /** False when the guess carried no platform (all platform credit lost). */
  present: boolean;
  /** Offset of the guessed plane from the true plane along the true normal (in-plane position is unobservable). */
  positionError?: number;
  /** Degrees between the guessed and true top-face normals. */
  normalError?: number;
  /** Room units per second, |v_guess - v_true|. */
  velocityError?: number;
  /** 0..1 share of the platform credit. */
  points: number;
}

export interface Score {
  /** 0-100. 100 iff every object (and the platform, in platform mode) is matched exactly (within tolerance) with no extras. */
  total: number;
  /** Name of the room symmetry under which the guess scored best (scoring is frame-invariant). */
  symmetry: string;
  exact: boolean;
  countTruth: number;
  countGuess: number;
  details: ScoreObjectDetail[];
  extraGuesses: number;
  /** Platform mode only. */
  platform?: ScorePlatformDetail;
}
