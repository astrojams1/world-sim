import type { CameraSpec, Vec3 } from "./types";

/**
 * Pinhole camera math that matches three.js's PerspectiveCamera + lookAt (up = +y).
 * Image coordinates are normalized: u in [0,1] left->right, v in [0,1] top->bottom.
 */
export interface Projector {
  /** Returns [u, v, depth] with depth > 0 in front of the camera; null if behind. */
  project(p: Vec3): [number, number, number] | null;
  /** Camera-space coordinates (x right, y up, -z forward). */
  toCamera(p: Vec3): Vec3;
  /** Project a camera-space point. */
  projectCam(c: Vec3): [number, number, number] | null;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export function makeProjector(cam: CameraSpec): Projector {
  const forward = norm(sub(cam.lookAt, cam.position)); // -z axis
  const worldUp: Vec3 = [0, 1, 0];
  const right = norm(cross(forward, worldUp)); // +x axis
  const up = cross(right, forward); // +y axis
  const f = 1 / Math.tan((cam.fov * Math.PI) / 360); // focal length for vertical fov
  const aspect = cam.aspect;

  const toCamera = (p: Vec3): Vec3 => {
    const d = sub(p, cam.position);
    return [dot(d, right), dot(d, up), -dot(d, forward)];
  };
  const projectCam = (c: Vec3): [number, number, number] | null => {
    const depth = -c[2];
    if (depth <= 1e-6) return null;
    const ndcX = (f / aspect) * (c[0] / depth);
    const ndcY = f * (c[1] / depth);
    return [(ndcX + 1) / 2, (1 - ndcY) / 2, depth];
  };
  return {
    toCamera,
    projectCam,
    project: (p) => projectCam(toCamera(p)),
  };
}

/**
 * Project a world-space segment, clipping against the near plane so segments that
 * cross behind the camera still render correctly. Returns normalized endpoints or null.
 */
export function projectSegment(
  proj: Projector,
  a: Vec3,
  b: Vec3,
  near = 0.02,
): [[number, number], [number, number]] | null {
  let ca = proj.toCamera(a);
  let cb = proj.toCamera(b);
  const da = -ca[2];
  const db = -cb[2];
  if (da < near && db < near) return null;
  if (da < near || db < near) {
    const t = (near - da) / (db - da);
    const mid: Vec3 = [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t];
    if (da < near) ca = mid;
    else cb = mid;
  }
  const pa = proj.projectCam(ca);
  const pb = proj.projectCam(cb);
  if (!pa || !pb) return null;
  return [
    [pa[0], pa[1]],
    [pb[0], pb[1]],
  ];
}
