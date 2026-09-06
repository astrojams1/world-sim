#!/usr/bin/env node
/**
 * Render rooms with the app (no API calls) and save the camera feeds + ground truth, for testing the sandbox
 * helper offline (scripts/run-offline.py).
 *   node scripts/render-rooms.mjs --seeds 101-110,201-210 [--mode platform] [--objects 8] --out <dir>
 * Requires `npm run dev` on http://localhost:3000 and the pre-installed chromium (CHROMIUM_PATH).
 * Rooms are named <seed>, <seed>-o<N> or, in platform mode, <seed>-p / <seed>-p-o<N>; each gets camera_A.jpg,
 * camera_B.jpg (and camera_A2.jpg, camera_B2.jpg in platform mode) and truth.json.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "true"]);
    return acc;
  }, []),
);
const seeds = (args.seeds ?? "101-110").split(",").flatMap((s) => {
  const [a, b] = s.split("-").map(Number);
  return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a];
});
const mode = args.mode ?? "static";
const objects = args.objects ? Number(args.objects) : null;
const out = args.out ?? "bench/rooms";
const url = args.url ?? "http://localhost:3000/";
const feedIds = mode === "platform" ? ["A", "B", "A2", "B2"] : ["A", "B"];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const open = async () => {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector('img[alt="Camera A"]', { timeout: 60000 });
  if (mode !== "static") {
    await page.selectOption('select[aria-label="Mode"]', mode);
    await page.waitForSelector('img[alt="Camera B2"]', { timeout: 60000 });
  }
};
await open();
let sinceReload = 0;
for (const seed of seeds) {
  // The headless WebGL context goes black after roughly 14 renders in one page; reload every 6 seeds.
  if (sinceReload >= 6) {
    await open();
    sinceReload = 0;
  }
  sinceReload++;
  const seedInput = page.locator("input").first();
  await seedInput.fill(String(seed));
  await seedInput.press("Enter");
  await page.waitForTimeout(700);
  if (objects !== null) {
    await page.selectOption('select[aria-label="Objects"]', String(objects));
    await page.waitForTimeout(700);
  }
  await page.waitForFunction((ids) => ids.every((id) => document.querySelector(`img[alt="Camera ${id}"]`)?.getAttribute("src")), feedIds, { timeout: 30000 });
  const feeds = await page.evaluate((ids) => {
    const o = {};
    for (const id of ids) o[id] = document.querySelector(`img[alt="Camera ${id}"]`).src;
    o.truth = [...document.querySelectorAll("pre")].map((p) => p.textContent).find((t) => t.trim().startsWith("{"));
    return o;
  }, feedIds);
  const name = `${seed}${mode === "platform" ? "-p" : ""}${objects === null ? "" : `-o${objects}`}`;
  const dir = path.join(out, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const id of feedIds) fs.writeFileSync(path.join(dir, `camera_${id}.jpg`), Buffer.from(feeds[id].split(",")[1], "base64"));
  fs.writeFileSync(path.join(dir, "truth.json"), feeds.truth);
  if (feeds.A.length < 4000) throw new Error(`black render for ${name}: WebGL context lost`);
  console.log(name, JSON.parse(feeds.truth).objects.length, "objects");
}
await browser.close();
