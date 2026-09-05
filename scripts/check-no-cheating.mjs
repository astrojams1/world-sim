#!/usr/bin/env node
/**
 * Static anti-cheat gate. The model may receive ONLY: the two unaltered images, the fact that the room is a
 * 1x1x1 cube seen from two viewpoints, the generator's object rules, and the task. This script fails if the
 * code paths that talk to the model could carry anything else.
 */
import fs from "node:fs";

const fail = [];
const read = (p) => fs.readFileSync(p, "utf8");

const route = read("src/app/api/analyze/route.ts");
const skill = read("src/lib/skill.ts");
const helper = read("src/lib/sandbox/worldsim.py");
const app = read("src/components/App.tsx");

// 1. The request body type may contain only model, reasoningEffort, images.
const bodyType = route.match(/interface AnalyzeBody \{([\s\S]*?)\n\}/)?.[1] ?? "";
const fields = [...bodyType.matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1]);
for (const f of fields) if (!["model", "reasoningEffort", "images"].includes(f)) fail.push(`route.ts: AnalyzeBody carries extra field '${f}'`);

// 2. Only the helper module and the two images are uploaded to the sandbox.
const uploads = [...route.matchAll(/upload\(SANDBOX_FILES\.(\w+)/g)].map((m) => m[1]).sort();
if (uploads.join(",") !== "A,B,helper") fail.push(`route.ts: sandbox uploads are [${uploads}], expected [A,B,helper]`);
if (/scene\.json|sceneFile|PublicRoom/.test(route)) fail.push("route.ts: references scene/calibration data");

// 3. The system prompt is a function of nothing (no room data can flow in).
if (!/export function buildSystemPrompt\(\): string/.test(skill)) fail.push("skill.ts: buildSystemPrompt must take no arguments");
if (/room\.(cameras|colors|lighting|objects)|position=|lookAt|fov=/.test(skill)) fail.push("skill.ts: prompt references camera or room data");
if (/#[0-9a-f]{6}/i.test(skill)) fail.push("skill.ts: prompt contains a hex colour");

// 4. The helper reads only the two images (no scene.json, no truth).
if (/scene\.json|truth|cams\.json/.test(helper)) fail.push("worldsim.py: references scene/truth data");
const finds = [...helper.matchAll(/(?<!def )_find\((f?"[^"]*")\)/g)].map((m) => m[1]);
for (const o of finds) if (!/camera_/.test(o)) fail.push(`worldsim.py: opens unexpected file ${o}`);
// Any open() other than the images must be the append-mode write of the session transcript.
const reads = [...helper.matchAll(/open\(([^)]*)\)/g)].map((m) => m[1]).filter((a) => !/_find\(/.test(a));
for (const r of reads) if (!/^_LOG_PATH, "a"$/.test(r.trim())) fail.push(`worldsim.py: unexpected open(${r})`);

// 5. The client sends nothing but the feeds.
const body = app.match(/body: JSON\.stringify\(\{([\s\S]*?)\}\),/)?.[1] ?? "";
for (const k of [...body.matchAll(/^\s*(\w+)[,:]/gm)].map((m) => m[1])) if (!["model", "reasoningEffort", "images"].includes(k)) fail.push(`App.tsx: request carries '${k}'`);
if (/room\.(cameras|colors|lighting|objects)/.test(body)) fail.push("App.tsx: request body references room data");

// 6. Feeds are the raw renders (no annotation step between render and request).
if (/annotate/i.test(app) || /annotate/i.test(read("src/lib/feeds.ts"))) fail.push("feeds are post-processed before being sent");

if (fail.length) {
  console.error("ANTI-CHEAT CHECK FAILED:\n - " + fail.join("\n - "));
  process.exit(1);
}
console.log("anti-cheat check passed: the model receives only the two raw images, the helper module and the fixed prompt.");
