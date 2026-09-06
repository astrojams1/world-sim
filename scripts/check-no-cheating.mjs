#!/usr/bin/env node
/**
 * Static anti-cheat gate. The model may receive ONLY: the unaltered images (two in static mode, four in platform
 * mode), the fact that the room is a 1x1x1 cube seen from two viewpoints, the generator's rules for the mode, and
 * the task. The mode itself is the only other thing the client tells the server, and it selects a fixed prompt.
 * This script fails if the code paths that talk to the model could carry anything else.
 */
import fs from "node:fs";

const fail = [];
const read = (p) => fs.readFileSync(p, "utf8");

const route = read("src/app/api/analyze/route.ts");
const skill = read("src/lib/skill.ts");
const helper = read("src/lib/sandbox/worldsim.py");
const app = read("src/components/App.tsx");

const ALLOWED_FIELDS = ["model", "reasoningEffort", "mode", "images"];

// 1. The request body type may contain only model, reasoningEffort, mode, images.
const bodyType = route.match(/interface AnalyzeBody \{([\s\S]*?)\n\}/)?.[1] ?? "";
const fields = [...bodyType.matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1]);
for (const f of fields) if (!ALLOWED_FIELDS.includes(f)) fail.push(`route.ts: AnalyzeBody carries extra field '${f}'`);
const imagesType = bodyType.match(/images: \{([^}]*)\}/)?.[1] ?? "";
for (const k of [...imagesType.matchAll(/(\w+)\??:/g)].map((m) => m[1])) if (!["A", "B", "A2", "B2"].includes(k)) fail.push(`route.ts: images carry '${k}'`);

// 2. Only the helper module and the images of the mode are uploaded to the sandbox.
if (!/upload\(SANDBOX_FILES\.helper, WORLDSIM_PY\)/.test(route)) fail.push("route.ts: the helper module upload is missing");
if (!/ids\.map\(\(id\) => upload\(SANDBOX_FILES\[id\], dataUrlToBuffer\(body\.images\[id\]!\)\)\)/.test(route)) fail.push("route.ts: sandbox uploads are not exactly the mode's images");
if ((route.match(/upload\(/g) ?? []).length !== 2) fail.push("route.ts: unexpected upload() calls"); // the helper and the mode's images, nothing else
if (/scene\.json|sceneFile|PublicRoom|platform\.(position|normal|velocity)|room\./.test(route)) fail.push("route.ts: references scene/calibration data");
const sandboxFiles = skill.match(/export const SANDBOX_FILES = \{([\s\S]*?)\}/)?.[1] ?? "";
for (const [, name] of sandboxFiles.matchAll(/"([^"]+)"/g)) if (!/^(worldsim\.py|camera_(A|B|A2|B2)\.jpg)$/.test(name)) fail.push(`skill.ts: unexpected sandbox file ${name}`);

// 3. The system prompt is a function of the mode only (no room data can flow in).
if (!/export function buildSystemPrompt\(mode: Mode = "static"\): string/.test(skill)) fail.push("skill.ts: buildSystemPrompt must take only the mode");
if (!/export function buildUserText\(mode: Mode = "static"\): string/.test(skill)) fail.push("skill.ts: buildUserText must take only the mode");
if (/room\.(cameras|colors|lighting|objects|platform)|position=|lookAt|fov=/.test(skill)) fail.push("skill.ts: prompt references camera or room data");
if (/#[0-9a-f]{6}/i.test(skill)) fail.push("skill.ts: prompt contains a hex colour");
// the prompt may import only fixed generator constants from room.ts
const roomImport = skill.match(/import \{([^}]*)\} from "\.\/room"/)?.[1] ?? "";
for (const name of roomImport.split(",").map((s) => s.trim()).filter(Boolean)) {
  if (!/^(GRID|SIZES|PLATFORM_[A-Z_]+|SNAPSHOT_INTERVAL|MAX_OBJECTS|MIN_OBJECTS)$/.test(name)) fail.push(`skill.ts: imports '${name}' from room.ts (only fixed constants are allowed)`);
}

// 4. The helper reads only the images (no scene.json, no truth).
if (/scene\.json|truth|cams\.json/.test(helper)) fail.push("worldsim.py: references scene/truth data");
const finds = [...helper.matchAll(/(?<!def )_find\((f?"[^"]*")\)/g)].map((m) => m[1]);
for (const o of finds) if (!/camera_/.test(o)) fail.push(`worldsim.py: opens unexpected file ${o}`);
// Any open() other than the images must be the append-mode write of the session transcript.
const reads = [...helper.matchAll(/open\(([^)]*)\)/g)].map((m) => m[1]).filter((a) => !/_find\(/.test(a));
for (const r of reads) if (!/^_LOG_PATH, "a"$/.test(r.trim())) fail.push(`worldsim.py: unexpected open(${r})`);

// 5. The client sends nothing but the feeds and the mode.
const body = app.match(/body: JSON\.stringify\(\{([\s\S]*?)\}\),/)?.[1] ?? "";
for (const k of [...body.matchAll(/^\s*(\w+)[,:]/gm)].map((m) => m[1])) if (!ALLOWED_FIELDS.includes(k)) fail.push(`App.tsx: request carries '${k}'`);
if (/room\.(cameras|colors|lighting|objects|platform|seed)/.test(body)) fail.push("App.tsx: request body references room data");
if (!/mode: room\.mode/.test(body)) fail.push("App.tsx: the mode sent must be the room's mode");

// 6. Feeds are the raw renders (no annotation step between render and request).
if (/annotate/i.test(app) || /annotate/i.test(read("src/lib/feeds.ts"))) fail.push("feeds are post-processed before being sent");

if (fail.length) {
  console.error("ANTI-CHEAT CHECK FAILED:\n - " + fail.join("\n - "));
  process.exit(1);
}
console.log("anti-cheat check passed: the model receives only the raw images of the mode, the helper module and the mode's fixed prompt.");
