import type { Guess, Room, Score, ScoreObjectDetail, Vec3 } from "./types";

// Tolerances for "exact" credit.
export const POS_TOL = 0.03; // room units (room is 1 unit wide)
export const SIZE_TOL = 0.012;
export const ORI_TOL = 10; // degrees
const POS_ZERO = 0.35; // position error at which position credit reaches 0
const ORI_ZERO = 45; // orientation error (degrees) at which orientation credit reaches 0

// Spheres: shape 20, colour 20, size 20, position 40. Cubes: position 30 + orientation 10.
const W = { shape: 0.2, color: 0.2, size: 0.2, position: 0.4, cubePosition: 0.3, orientation: 0.1 };

type Mat3 = [Vec3, Vec3, Vec3];

function dist(a: Vec3, b: Vec3) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function matMul(a: Mat3, b: Mat3): Mat3 {
  const r: Mat3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
  return r;
}
function transpose(a: Mat3): Mat3 {
  return [
    [a[0][0], a[1][0], a[2][0]],
    [a[0][1], a[1][1], a[2][1]],
    [a[0][2], a[1][2], a[2][2]],
  ];
}
function det(a: Mat3): number {
  return (
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) -
    a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) +
    a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0])
  );
}

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

/** Angle (degrees) between two rotations. */
function rotationAngle(a: Mat3, b: Mat3): number {
  const m = matMul(a, transpose(b));
  const tr = m[0][0] + m[1][1] + m[2][2];
  return (Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2))) * 180) / Math.PI;
}

/** The 24 proper rotations that map a cube onto itself (signed permutation matrices with determinant +1). */
const CUBE_ROTATIONS: Mat3[] = (() => {
  const out: Mat3[] = [];
  const perms = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ];
  for (const perm of perms) {
    for (const signs of [
      [1, 1, 1],
      [1, 1, -1],
      [1, -1, 1],
      [1, -1, -1],
      [-1, 1, 1],
      [-1, 1, -1],
      [-1, -1, 1],
      [-1, -1, -1],
    ]) {
      const m: Mat3 = [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ];
      for (let i = 0; i < 3; i++) m[i][perm[i]] = signs[i];
      if (det(m) > 0.5) out.push(m);
    }
  }
  return out;
})();

/** Smallest angle between a guessed and a true cube orientation, over the cube's 24 symmetries. */
export function orientationError(guess: Mat3, truth: Mat3): number {
  let best = 180;
  for (const S of CUBE_ROTATIONS) best = Math.min(best, rotationAngle(guess, matMul(truth, S)));
  return best;
}

interface GuessObj {
  shape: Room["objects"][number]["shape"];
  color: Room["objects"][number]["color"];
  size: number;
  position: Vec3;
  rotationMatrix?: Mat3;
}

function pairPoints(t: Room["objects"][number], g: GuessObj) {
  const shapeOk = t.shape === g.shape;
  const colorOk = t.color === g.color;
  const sizeError = Math.abs(t.size - g.size);
  const positionError = dist(t.position, g.position);
  const sizePts = sizeError <= SIZE_TOL ? 1 : Math.max(0, 1 - (sizeError - SIZE_TOL) / 0.15);
  const posPts = positionError <= POS_TOL ? 1 : Math.max(0, 1 - (positionError - POS_TOL) / POS_ZERO);
  let points = (shapeOk ? W.shape : 0) + (colorOk ? W.color : 0) + W.size * sizePts;
  let oriError: number | undefined;
  if (t.shape === "cube" && t.rotation) {
    points += W.cubePosition * posPts;
    if (shapeOk && g.rotationMatrix) {
      oriError = orientationError(g.rotationMatrix, eulerToMatrix(t.rotation));
      const oriPts = oriError <= ORI_TOL ? 1 : Math.max(0, 1 - (oriError - ORI_TOL) / (ORI_ZERO - ORI_TOL));
      points += W.orientation * oriPts;
    }
  } else {
    points += W.position * posPts;
  }
  return { shapeOk, colorOk, sizeError, positionError, orientationError: oriError, points };
}

/**
 * The 48 symmetries of the unit cube about its centre, as signed axis permutations.
 * The model receives no calibration, so it cannot know which corner of the room is
 * the origin; scoring is therefore invariant to these symmetries.
 */
const SYMMETRIES: Array<{ name: string; apply: (p: Vec3) => Vec3; matrix: Mat3 }> = (() => {
  const out: Array<{ name: string; apply: (p: Vec3) => Vec3; matrix: Mat3 }> = [];
  const perms: number[][] = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ];
  const axes = ["x", "y", "z"];
  for (const perm of perms) {
    for (const signs of [
      [1, 1, 1],
      [1, 1, -1],
      [1, -1, 1],
      [1, -1, -1],
      [-1, 1, 1],
      [-1, 1, -1],
      [-1, -1, 1],
      [-1, -1, -1],
    ]) {
      const name = perm.map((a, i) => `${signs[i] < 0 ? "-" : "+"}${axes[a]}`).join("");
      const matrix: Mat3 = [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ];
      for (let i = 0; i < 3; i++) matrix[i][perm[i]] = signs[i];
      out.push({
        name,
        matrix,
        apply: (p) => {
          const c = [p[0] - 0.5, p[1] - 0.5, p[2] - 0.5];
          return [0.5 + signs[0] * c[perm[0]], 0.5 + signs[1] * c[perm[1]], 0.5 + signs[2] * c[perm[2]]];
        },
      });
    }
  }
  return out;
})();

/**
 * Score a guess against the true room, invariant to the room's symmetries (the
 * best of the 48 frames is reported). Objects are matched by exhaustive
 * assignment (n <= 6) to maximise total points. 100 means every true object is
 * matched with correct shape/color, size within tolerance, position within
 * tolerance, and there are no extra guessed objects.
 */
export function scoreGuess(room: Room, guess: Guess): Score {
  let best: Score | null = null;
  const objects = Array.isArray(guess?.objects) ? guess.objects : [];
  for (const sym of SYMMETRIES) {
    const Mt = transpose(sym.matrix);
    const transformed: GuessObj[] = objects.map((o) => {
      const rot = o.shape === "cube" && o.rotation && o.rotation.length === 3 && o.rotation.every((v) => Number.isFinite(v)) ? eulerToMatrix(o.rotation) : undefined;
      return {
        shape: o.shape,
        color: o.color,
        size: o.size,
        position: sym.apply(o.position),
        // a frame change M turns an orientation R into M R M^T
        rotationMatrix: rot ? matMul(sym.matrix, matMul(rot, Mt)) : undefined,
      };
    });
    const sc = scoreInFrame(room, transformed, sym.name);
    if (!best || sc.total > best.total || (sc.exact && !best.exact)) best = sc;
    if (best.exact) break;
  }
  return best!;
}

function scoreInFrame(room: Room, guessed: GuessObj[], symmetry: string): Score {
  const truth = room.objects;
  const n = truth.length;
  const m = guessed.length;

  // Precompute pair points
  const P = truth.map((t) => guessed.map((g) => pairPoints(t, g)));

  // Exhaustive assignment: for each truth object pick a distinct guess (or none).
  let best = -1;
  let bestAssign: number[] = [];
  const assign: number[] = new Array(n).fill(-1);
  const used: boolean[] = new Array(m).fill(false);
  const rec = (i: number, acc: number) => {
    if (i === n) {
      if (acc > best) {
        best = acc;
        bestAssign = [...assign];
      }
      return;
    }
    // option: unmatched
    assign[i] = -1;
    rec(i + 1, acc);
    for (let j = 0; j < m; j++) {
      if (used[j]) continue;
      used[j] = true;
      assign[i] = j;
      rec(i + 1, acc + P[i][j].points);
      used[j] = false;
    }
    assign[i] = -1;
  };
  rec(0, 0);

  const details: ScoreObjectDetail[] = truth.map((t, i) => {
    const j = bestAssign[i];
    if (j == null || j < 0) return { truthId: t.id, matched: false, points: 0 };
    const p = P[i][j];
    return { truthId: t.id, matched: true, guessIndex: j, ...p };
  });
  const matchedCount = details.filter((d) => d.matched).length;
  const extraGuesses = m - matchedCount;
  const raw = details.reduce((s, d) => s + d.points, 0) / Math.max(1, n);
  // Each extra object costs as much as one missing object.
  const penalised = Math.max(0, raw - extraGuesses / Math.max(1, n));
  const total = Math.round(penalised * 1000) / 10;
  const exact =
    extraGuesses === 0 &&
    details.every(
      (d) =>
        d.matched &&
        d.shapeOk &&
        d.colorOk &&
        (d.sizeError ?? 1) <= SIZE_TOL &&
        (d.positionError ?? 1) <= POS_TOL &&
        (d.orientationError === undefined ? truth[details.indexOf(d)].shape !== "cube" : d.orientationError <= ORI_TOL),
    );
  return { total: exact ? 100 : Math.min(total, 99.9), exact, symmetry, countTruth: n, countGuess: m, details, extraGuesses };
}
