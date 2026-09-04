import type { Guess, Room, Score, ScoreObjectDetail, Vec3 } from "./types";

// Tolerances for "exact" credit.
export const POS_TOL = 0.03; // room units (room is 1 unit wide)
export const SIZE_TOL = 0.012;
const POS_ZERO = 0.35; // position error at which position credit reaches 0

const W = { shape: 0.2, color: 0.2, size: 0.2, position: 0.4 };

function dist(a: Vec3, b: Vec3) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function pairPoints(t: Room["objects"][number], g: Guess["objects"][number]) {
  const shapeOk = t.shape === g.shape;
  const colorOk = t.color === g.color;
  const sizeError = Math.abs(t.size - g.size);
  const positionError = dist(t.position, g.position);
  const sizePts = sizeError <= SIZE_TOL ? 1 : Math.max(0, 1 - (sizeError - SIZE_TOL) / 0.15);
  const posPts = positionError <= POS_TOL ? 1 : Math.max(0, 1 - (positionError - POS_TOL) / POS_ZERO);
  const points =
    (shapeOk ? W.shape : 0) + (colorOk ? W.color : 0) + W.size * sizePts + W.position * posPts;
  return { shapeOk, colorOk, sizeError, positionError, points };
}

/**
 * Score a guess against the true room. Objects are matched by exhaustive
 * assignment (n <= 6) to maximise total points. 100 means every true object is
 * matched with correct shape/color, size within tolerance, position within
 * tolerance, and there are no extra guessed objects.
 */
export function scoreGuess(room: Room, guess: Guess): Score {
  const truth = room.objects;
  const guessed = Array.isArray(guess?.objects) ? guess.objects : [];
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
        (d.positionError ?? 1) <= POS_TOL,
    );
  return { total: exact ? 100 : Math.min(total, 99.9), exact, countTruth: n, countGuess: m, details, extraGuesses };
}
