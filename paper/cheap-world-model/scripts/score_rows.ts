/**
 * Score guesses against truths with the repo's own scorer and emit per-object details.
 *   npx tsx paper/cheap-world-model/scripts/score_rows.ts <input.json> [<output.json>]
 * input: [{ name, truth: {objects:[...]}|[...], guess: {objects:[...]} }, ...]
 * output: same rows with { score: number, exact, symmetry, details: [...], extraGuesses }.
 */
import fs from "node:fs";
import { scoreGuess } from "../../../src/lib/score";
import type { Room } from "../../../src/lib/types";

const [input, output] = process.argv.slice(2);
const rows = JSON.parse(fs.readFileSync(input, "utf8"));
const out = rows.map((r: any) => {
  const truthObjects = Array.isArray(r.truth) ? r.truth : r.truth.objects;
  const room = { objects: truthObjects.map((o: any, i: number) => ({ id: i + 1, ...o })) } as unknown as Room;
  const guess = { objects: (r.guess?.objects ?? r.guess ?? []).map((o: any) => ({ ...o, rotation: o.rotation ?? undefined })) };
  const s = scoreGuess(room, guess);
  return { ...r, score: s.total, exact: s.exact, symmetry: s.symmetry, extraGuesses: s.extraGuesses, details: s.details };
});
const text = JSON.stringify(out, null, 1);
if (output) fs.writeFileSync(output, text);
else process.stdout.write(text);
