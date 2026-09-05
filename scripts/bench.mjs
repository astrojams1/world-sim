#!/usr/bin/env node
/**
 * Benchmark the skill over a fixed set of rooms by driving the running app with Playwright.
 *
 *   npm run dev                                  # in another terminal, with OPENAI_API_KEY in .env.local
 *   npx playwright install chromium              # once
 *   node scripts/bench.mjs --label baseline [--seeds 101,102,...] [--model gpt-5-mini] [--effort medium]
 *                          [--parallel 3] [--url http://localhost:3000] [--out bench/results]
 *
 * Every request the page makes to /api/analyze is intercepted and checked: the body may contain only
 * { model, reasoningEffort, images:{A,B} } and the images must be exactly the data URLs shown in the page.
 * Writes <out>/<label>.json with per-seed rows and a summary (score, exact matches, time, tokens, cost).
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

/** The fixed benchmark set. Do not change without bumping BENCH_SET_VERSION in bench/BENCH.md. */
export const BENCH_SEEDS = [101, 102, 103, 104, 105, 106, 107, 108, 109, 110];

const seeds = args.seeds ? args.seeds.split(",").map(Number) : BENCH_SEEDS;
const model = args.model ?? "gpt-5-mini";
const effort = args.effort ?? "medium";
const parallel = Number(args.parallel ?? 3);
const url = args.url ?? "http://localhost:3000/";
const label = args.label ?? new Date().toISOString().replace(/[:.]/g, "-");
const outDir = args.out ?? "bench/results";
const timeoutMs = Number(args.timeout ?? 1500000);
// Rooms whose run failed with an API-side error (rate limit, moderation false positive, network) are retried once;
// such failures say nothing about the skill. Timeouts and model answers are never retried.
const retryErrors = Number(args["retry-errors"] ?? 1);

// Published list prices (USD per 1M tokens) used for the cost estimate; edit if pricing changes.
const PRICES = {
  "gpt-5-mini": { input: 0.25, cached: 0.025, output: 2.0 },
  "gpt-5-nano": { input: 0.05, cached: 0.005, output: 0.4 },
  "gpt-5.4-mini": { input: 0.25, cached: 0.025, output: 2.0 },
  "gpt-4.1-mini": { input: 0.4, cached: 0.1, output: 1.6 },
  "gpt-4o-mini": { input: 0.15, cached: 0.075, output: 0.6 },
};
const CODE_INTERPRETER_SESSION_USD = 0.03;

function estimateCost(modelId, usage) {
  const p = PRICES[modelId];
  if (!p || !usage) return null;
  const cached = usage.input_tokens_details?.cached_tokens ?? 0;
  const input = (usage.input_tokens ?? 0) - cached;
  const output = usage.output_tokens ?? 0;
  return (input * p.input + cached * p.cached + output * p.output) / 1e6 + CODE_INTERPRETER_SESSION_USD;
}

const ALLOWED_KEYS = new Set(["model", "reasoningEffort", "images"]);

async function runSeed(browser, seed) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const violations = [];
  let shownFeeds = null;
  await page.route("**/api/analyze", async (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      let body = {};
      try {
        body = JSON.parse(req.postData() ?? "{}");
      } catch {
        violations.push("POST body is not JSON");
      }
      for (const k of Object.keys(body)) if (!ALLOWED_KEYS.has(k)) violations.push(`unexpected request field: ${k}`);
      if (!shownFeeds) {
        shownFeeds = await page.evaluate(() => ({
          A: document.querySelector('img[alt="Camera A"]')?.getAttribute("src"),
          B: document.querySelector('img[alt="Camera B"]')?.getAttribute("src"),
        }));
      }
      if (body.images?.A !== shownFeeds.A || body.images?.B !== shownFeeds.B) violations.push("images sent differ from the images shown");
    }
    await route.continue();
  });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector('img[alt="Camera A"]', { timeout: 30000 });
  const seedInput = page.locator("input").first();
  await seedInput.fill(String(seed));
  await seedInput.press("Enter");
  await page.waitForTimeout(1200);
  await page.selectOption("select >> nth=0", model);
  if (model.startsWith("gpt-5")) await page.selectOption("select >> nth=1", effort);
  const t0 = Date.now();
  await page.click('button:has-text("Analyze")');
  let result = null;
  try {
    await page.waitForFunction(() => window.__worldsim !== undefined, null, { timeout: timeoutMs });
    result = await page.evaluate(() => window.__worldsim);
  } catch {
    result = { seed, score: 0, exact: false, durationMs: Date.now() - t0, error: `timeout after ${timeoutMs} ms` };
  }
  await page.close();
  const usage = result.usage ?? null;
  return {
    seed,
    score: result.score,
    exact: Boolean(result.exact),
    seconds: +(result.durationMs / 1000).toFixed(1),
    tokens: usage
      ? { input: usage.input_tokens ?? 0, cached: usage.input_tokens_details?.cached_tokens ?? 0, output: usage.output_tokens ?? 0, reasoning: usage.output_tokens_details?.reasoning_tokens ?? 0, total: usage.total_tokens ?? 0 }
      : null,
    costUsd: estimateCost(model, usage),
    codeRuns: result.codeRuns ?? 0,
    usedSandbox: Boolean(result.usedSandbox),
    violations,
    error: result.error ?? null,
    guess: result.guess ?? null,
    truth: result.truth ?? null,
  };
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const queue = [...seeds];
const rows = [];
const started = Date.now();
await Promise.all(
  Array.from({ length: Math.min(parallel, queue.length) }, async () => {
    while (queue.length) {
      const seed = queue.shift();
      let row = await runSeed(browser, seed);
      for (let attempt = 0; attempt < retryErrors && row.error && !/timeout/i.test(row.error); attempt++) {
        console.log(JSON.stringify({ seed, retry: attempt + 1, error: row.error }));
        row = await runSeed(browser, seed);
        row.retried = attempt + 1;
      }
      rows.push(row);
      console.log(JSON.stringify({ seed: row.seed, score: row.score, exact: row.exact, seconds: row.seconds, tokens: row.tokens?.total ?? null, costUsd: row.costUsd?.toFixed(3) ?? null, codeRuns: row.codeRuns, violations: row.violations, error: row.error }));
    }
  }),
);
await browser.close();
rows.sort((a, b) => a.seed - b.seed);

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const ok = rows.filter((r) => !r.error);
const summary = {
  label,
  model,
  effort,
  seeds,
  rooms: rows.length,
  errors: rows.length - ok.length,
  meanScore: +mean(rows.map((r) => r.score)).toFixed(1),
  exactMatches: rows.filter((r) => r.exact).length,
  meanSeconds: +mean(rows.map((r) => r.seconds)).toFixed(1),
  wallClockSeconds: +((Date.now() - started) / 1000).toFixed(1),
  meanTokens: Math.round(mean(ok.map((r) => r.tokens?.total ?? 0))),
  totalCostUsd: +ok.reduce((s, r) => s + (r.costUsd ?? 0), 0).toFixed(3),
  meanCostUsd: +mean(ok.map((r) => r.costUsd ?? 0)).toFixed(3),
  violations: rows.flatMap((r) => r.violations.map((v) => `${r.seed}: ${v}`)),
  ranAt: new Date().toISOString(),
};
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, `${label}.json`), JSON.stringify({ summary, rows }, null, 2));
console.log("\n" + JSON.stringify(summary, null, 2));
if (summary.violations.length) {
  console.error("ANTI-CHEAT VIOLATIONS:", summary.violations);
  process.exitCode = 2;
}
