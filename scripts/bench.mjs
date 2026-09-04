#!/usr/bin/env node
/**
 * Benchmark the skill over many random rooms by driving the running app with Playwright.
 *
 *   npm run dev                       # in another terminal, with OPENAI_API_KEY in .env.local
 *   npx playwright install chromium   # once
 *   node scripts/bench.mjs --n 10 --model gpt-5-mini [--url http://localhost:3000] [--seeds 1,2,3]
 */
import { chromium } from "playwright";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "true"]);
    return acc;
  }, []),
);
const n = Number(args.n ?? 5);
const model = args.model ?? "gpt-5-mini";
const url = args.url ?? "http://localhost:3000/";
const seeds = args.seeds ? args.seeds.split(",").map(Number) : Array.from({ length: n }, () => Math.floor(Math.random() * 2 ** 31));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const results = [];
for (const seed of seeds) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector('img[alt="Camera A"]', { timeout: 30000 });
  const seedInput = page.locator("input").first();
  await seedInput.fill(String(seed));
  await seedInput.press("Enter");
  await page.waitForTimeout(1200);
  await page.selectOption("select >> nth=0", model);
  const t0 = Date.now();
  await page.click('button:has-text("Analyze")');
  await page.waitForFunction(
    () => {
      const b = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Analyz"));
      return b && b.textContent.trim() === "Analyze";
    },
    null,
    { timeout: 600000 },
  );
  const err = await page.evaluate(() => document.querySelector(".text-red-300")?.textContent ?? null);
  const scores = await page.evaluate(() =>
    [...document.querySelectorAll(".text-2xl.font-semibold")].map((e) => parseFloat(e.textContent)).filter((x) => !Number.isNaN(x)),
  );
  const row = { seed, score: scores.at(-1) ?? null, seconds: +((Date.now() - t0) / 1000).toFixed(1), err };
  results.push(row);
  console.log(JSON.stringify(row));
  await page.close();
}
await browser.close();
const ok = results.filter((r) => r.score != null);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
console.log("\nmodel", model, "rooms", results.length);
console.log("mean score   ", mean(ok.map((r) => r.score)).toFixed(1));
console.log("exact matches", ok.filter((r) => r.score === 100).length);
console.log("mean seconds     ", mean(ok.map((r) => r.seconds)).toFixed(1));
