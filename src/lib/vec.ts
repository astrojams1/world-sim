import type { Vec3 } from "./types";

/** Small vector helpers shared by the generator, the renderer and the scorer. */
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: Vec3): Vec3 => {
  const l = length(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const round3 = (a: Vec3): Vec3 => a.map((v) => Math.round(v * 1000) / 1000) as Vec3;

export type Mat3 = [Vec3, Vec3, Vec3];

export const matVec = (m: Mat3, v: Vec3): Vec3 => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];
/** Matrix whose columns are the given vectors. */
export const fromColumns = (x: Vec3, y: Vec3, z: Vec3): Mat3 => [
  [x[0], y[0], z[0]],
  [x[1], y[1], z[1]],
  [x[2], y[2], z[2]],
];
export function matMul(a: Mat3, b: Mat3): Mat3 {
  const r: Mat3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
  return r;
}
export const transpose = (a: Mat3): Mat3 => [
  [a[0][0], a[1][0], a[2][0]],
  [a[0][1], a[1][1], a[2][1]],
  [a[0][2], a[1][2], a[2][2]],
];
export const det = (a: Mat3): number =>
  a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) -
  a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) +
  a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);

/** Rotation matrix from Euler XYZ angles (radians), matching three.js: R = Rx * Ry * Rz. */
export function eulerToMatrix([x, y, z]: Vec3): Mat3 {
  const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  const Rx: Mat3 = [
    [1, 0, 0],
    [0, cx, -sx],
    [0, sx, cx],
  ];
  const Ry: Mat3 = [
    [cy, 0, sy],
    [0, 1, 0],
    [-sy, 0, cy],
  ];
  const Rz: Mat3 = [
    [cz, -sz, 0],
    [sz, cz, 0],
    [0, 0, 1],
  ];
  return matMul(Rx, matMul(Ry, Rz));
}

/** Euler XYZ angles (radians) of a rotation matrix, the inverse of eulerToMatrix (three.js Euler.setFromRotationMatrix). */
export function matrixToEuler(m: Mat3): Vec3 {
  const m13 = m[0][2];
  const y = Math.asin(Math.max(-1, Math.min(1, m13)));
  if (Math.abs(m13) < 0.9999999) return [Math.atan2(-m[1][2], m[2][2]), y, Math.atan2(-m[0][1], m[0][0])];
  return [Math.atan2(m[2][1], m[1][1]), y, 0];
}

/** Angle in degrees between two unit vectors. */
export function angleDeg(a: Vec3, b: Vec3): number {
  const c = dot(normalize(a), normalize(b));
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
}
