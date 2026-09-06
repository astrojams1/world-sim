/**
 * Score offline guesses against truths with the repo's own scorer (both modes) and print a per-room table.
 *   npx tsx scripts/score-rows.ts <input.json> [<output.json>]
 * input: [{ name, truth: {platform?, objects}, guess: {platform?, objects} }, ...] (scripts/run-offline.py output)
 * output: same rows with { score, exact, symmetry, details, extraGuesses, platform }.
 */
import fs from "node:fs";
import { scoreGuess } from "../src/lib/score";
import type { Guess, Room, RoomObject } from "../src/lib/types";

interface Row {
  name: string;
  truth: { platform?: Room["platform"]; objects: Omit<RoomObject, "id">[] } | Omit<RoomObject, "id">[];
  guess: Guess | null;
  seconds?: number;
  error?: string | null;
}

const [input, output] = process.argv.slice(2);
const rows: Row[] = JSON.parse(fs.readFileSync(input, "utf8"));
const out = rows.map((r) => {
  const truth = Array.isArray(r.truth) ? { objects: r.truth } : r.truth;
  const room = {
    mode: truth.platform ? "platform" : "static",
    objects: truth.objects.map((o, i) => ({ id: i + 1, ...o })),
    ...(truth.platform ? { platform: truth.platform } : {}),
  } as unknown as Room;
  const guess: Guess = {
    objects: (r.guess?.objects ?? []).map((o) => ({ ...o, rotation: o.rotation ?? undefined })),
    ...(r.guess?.platform ? { platform: r.guess.platform } : {}),
  };
  const s = scoreGuess(room, guess);
  return { ...r, score: s.total, exact: s.exact, symmetry: s.symmetry, extraGuesses: s.extraGuesses, details: s.details, platform: s.platform };
});
for (const r of out) {
  const p = r.platform;
  const plat = p ? ` platform pos ${p.positionError?.toFixed(3)} normal ${p.normalError?.toFixed(1)}deg vel ${p.velocityError?.toFixed(3)} (${(p.points * 100).toFixed(0)})` : "";
  const objs = r.details
    .map((d) => (d.matched ? `${d.shapeOk ? "" : "SHAPE "}${d.colorOk ? "" : "COLOR "}pos${d.positionError?.toFixed(3)}${d.orientationError !== undefined ? ` ori${d.orientationError.toFixed(0)}` : ""}` : "MISSING"))
    .join(" | ");
  console.log(`${r.name.padEnd(10)} ${String(r.score).padStart(5)} ${r.exact ? "exact" : "     "} ${String(r.seconds ?? "").padStart(6)}s${plat}  objs: ${objs}${r.extraGuesses ? ` +${r.extraGuesses} extra` : ""}${r.error ? ` ERROR ${r.error}` : ""}`);
}
const mean = out.reduce((s, r) => s + r.score, 0) / Math.max(1, out.length);
console.log(`mean ${mean.toFixed(1)} over ${out.length} rooms, ${out.filter((r) => r.exact).length} exact`);
if (output) fs.writeFileSync(output, JSON.stringify(out, null, 1));
