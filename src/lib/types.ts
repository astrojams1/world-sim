export type Vec3 = [number, number, number];

export type Shape = "sphere" | "cube";
export type ObjColor = "red" | "blue";

export interface RoomObject {
  id: number;
  shape: Shape;
  color: ObjColor;
  /** Edge length for cubes, diameter for spheres. */
  size: number;
  /** Center of the object, in room coordinates. */
  position: Vec3;
}

export interface CameraSpec {
  id: "A" | "B";
  position: Vec3;
  lookAt: Vec3;
  /** Vertical field of view in degrees. */
  fov: number;
  /** Aspect ratio width / height of the rendered feed. */
  aspect: number;
}

export interface Lighting {
  ambientIntensity: number;
  keyLight: { position: Vec3; intensity: number; color: string };
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
  colors: RoomColors;
  lighting: Lighting;
  cameras: [CameraSpec, CameraSpec];
  objects: RoomObject[];
  seed: number;
}

/** The subset of the room the model is asked to reconstruct. */
export interface Guess {
  objects: Array<{ shape: Shape; color: ObjColor; size: number; position: Vec3 }>;
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
  points: number;
}

export interface Score {
  /** 0-100. 100 iff every object is matched exactly (within tolerance) with no extras. */
  total: number;
  exact: boolean;
  countTruth: number;
  countGuess: number;
  details: ScoreObjectDetail[];
  extraGuesses: number;
}
