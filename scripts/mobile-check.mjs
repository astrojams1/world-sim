#!/usr/bin/env node
/**
 * Mobile usability check, driven with Playwright against the running app (`npm run dev`).
 *   node scripts/mobile-check.mjs [--url http://localhost:3000] [--out bench/mobile] [--shots]
 * For phone, tablet and desktop viewports, in both modes, before and after an (mocked) analysis:
 *   - the page never scrolls horizontally and no element sticks out of the viewport,
 *   - every control (button, select, input, summary) is at least 40 px tall and inside the viewport,
 *   - on phones, text inputs and selects use a 16 px font (iOS zooms into smaller ones),
 *   - the feeds, the 3D viewer, the score card, the tables and the code transcript are visible and usable
 *     (tables and transcripts scroll inside their own container), the 3D canvas fits its box on 2x screens, and
 *     a one-finger vertical swipe over the viewer scrolls the page.
 * The analysis is mocked: /api/analyze answers with a perturbed copy of the room's own ground truth, so the
 * result panels render without an API key. Exits 1 on any failure and lists them.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, devices } from "playwright";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "true"]);
    return acc;
  }, []),
);
const url = args.url ?? "http://localhost:3000/";
const out = args.out ?? "bench/mobile";
const shots = args.shots === "true";
fs.mkdirSync(out, { recursive: true });

const VIEWPORTS = [
  { name: "iphone-se", ...devices["iPhone SE"] },
  { name: "iphone-14", ...devices["iPhone 14"] },
  { name: "pixel-7", ...devices["Pixel 7"] },
  { name: "iphone-14-landscape", ...devices["iPhone 14 landscape"] },
  { name: "ipad-mini", ...devices["iPad Mini"] },
  { name: "desktop", viewport: { width: 1280, height: 800 } },
];

const failures = [];
const fail = (ctx, msg) => failures.push(`${ctx}: ${msg}`);

/** Mock the analysis API: the "model" returns the room's ground truth, slightly perturbed. */
async function mockApi(page) {
  await page.route("**/api/analyze**", async (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      return route.fulfill({ json: { responseId: "resp_mobilecheck", status: "queued" } });
    }
    const truth = await page.evaluate(() => {
      const pre = [...document.querySelectorAll("pre")].map((p) => p.textContent).find((t) => t?.trim().startsWith("{"));
      return pre ? JSON.parse(pre) : null;
    });
    const jitter = (v, d) => +(v + d).toFixed(3);
    const guess = {
      objects: (truth?.objects ?? []).map((o, i) => ({
        ...o,
        position: o.position.map((v, k) => jitter(v, ((i + k) % 3) * 0.004)),
        rotation: o.rotation ?? null,
      })),
      ...(truth?.platform ? { platform: { ...truth.platform, position: truth.platform.position.map((v) => jitter(v, 0.003)) } } : {}),
    };
    return route.fulfill({
      json: {
        status: "completed",
        guess,
        notes: "Mocked answer for the mobile check: the ground truth with a few thousandths of jitter.",
        usage: { input_tokens: 5000, output_tokens: 900, total_tokens: 5900 },
        model: "mock",
        codeRuns: [{ code: "import worldsim as ws\nr = ws.solve_all()\n" + "print(r)\n".repeat(20), logs: "", status: "completed" }],
        sessionLog: Array.from({ length: 40 }, (_, i) => `line ${i + 1}: a long transcript line that must scroll inside its own box rather than widen the page ${"x".repeat(60)}`).join("\n"),
        usedSandbox: true,
      },
    });
  });
}

async function audit(page, ctx, vw) {
  // 1. no horizontal scrolling of the page
  const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth, body: document.body.scrollWidth }));
  if (widths.scroll > widths.client + 1 || widths.body > widths.client + 1) fail(ctx, `page scrolls horizontally (scrollWidth ${widths.scroll}, body ${widths.body}, viewport ${widths.client})`);
  // 2. no element sticks out of the viewport horizontally (except inside a scrolling container)
  const sticking = await page.evaluate((vw) => {
    const out = [];
    const scrollers = (el) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const ov = getComputedStyle(p).overflowX;
        if (ov === "auto" || ov === "scroll" || ov === "hidden") return true;
      }
      return false;
    };
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if ((r.right > vw + 1 || r.left < -1) && !scrollers(el)) out.push(`${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).split(" ").slice(0, 2).join(".") : ""} [${Math.round(r.left)}..${Math.round(r.right)}]`);
    }
    return out.slice(0, 8);
  }, vw);
  for (const s of sticking) fail(ctx, `element outside the viewport: ${s}`);
  // 3. controls: tall enough to tap, inside the viewport, readable font
  const controls = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("button, select, input, summary, a")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      out.push({ tag: el.tagName.toLowerCase(), label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30), h: r.height, w: r.width, left: r.left, right: r.right, font: parseFloat(cs.fontSize), type: el.getAttribute("type") });
    }
    return out;
  });
  for (const c of controls) {
    if (c.tag === "input" && c.type === "checkbox") continue;
    if (c.h < 40) fail(ctx, `${c.tag} "${c.label}" is only ${Math.round(c.h)} px tall (need 40)`);
    if (c.right > vw + 1 || c.left < -1) fail(ctx, `${c.tag} "${c.label}" is outside the viewport`);
    if (vw < 640 && (c.tag === "input" || c.tag === "select") && c.font < 16) fail(ctx, `${c.tag} "${c.label}" has a ${c.font} px font (iOS zooms below 16)`);
  }
  // 4. scrollable blocks (tables, code) must not exceed their container
  const blocks = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("pre, table")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      let p = el.parentElement;
      while (p && !["auto", "scroll", "hidden"].includes(getComputedStyle(p).overflowX)) p = p.parentElement;
      const pr = p ? p.getBoundingClientRect() : null;
      out.push({ tag: el.tagName.toLowerCase(), right: r.right, containerRight: pr ? pr.right : null });
    }
    return out;
  });
  for (const b of blocks) if (b.containerRight === null && b.right > vw + 1) fail(ctx, `${b.tag} is wider than the viewport and has no scrolling container`);
}

async function run(device) {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  const { name, ...dev } = device;
  const context = await browser.newContext(dev);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await mockApi(page);
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector('img[alt="Camera A"]', { timeout: 60000 });
  const vw = dev.viewport.width;
  for (const mode of ["static", "platform"]) {
    const ctx = `${name} ${mode}`;
    await page.selectOption('select[aria-label="Mode"]', mode);
    const ids = mode === "platform" ? ["A", "B", "A2", "B2"] : ["A", "B"];
    await page.waitForFunction((ids) => ids.every((id) => document.querySelector(`img[alt="Camera ${id}"]`)?.getAttribute("src")), ids, { timeout: 30000 });
    await audit(page, `${ctx} before`, vw);
    // the feeds and the viewer are visible and have a sensible size
    for (const id of ids) {
      const box = await page.locator(`img[alt="Camera ${id}"]`).boundingBox();
      if (!box || box.width < Math.min(140, vw * 0.3)) fail(ctx, `feed ${id} is too small (${box ? Math.round(box.width) : "hidden"} px wide)`);
    }
    const viewer = await page.locator("canvas").first().boundingBox();
    if (!viewer || viewer.height < 200) fail(ctx, `3D viewer is ${viewer ? Math.round(viewer.height) : "missing"} px tall`);
    // the canvas must be laid out at its box's size (on 2x screens the drawing buffer is larger than the box)
    const box = await page.locator("canvas").first().evaluate((c) => {
      const p = c.parentElement.getBoundingClientRect();
      const r = c.getBoundingClientRect();
      return { cw: r.width, ch: r.height, pw: p.width, ph: p.height };
    });
    if (box.cw > box.pw + 1 || box.ch > box.ph + 1) fail(ctx, `3D canvas (${Math.round(box.cw)}x${Math.round(box.ch)}) overflows its box (${Math.round(box.pw)}x${Math.round(box.ph)})`);
    // a one-finger vertical swipe over the viewer must scroll the page, not only orbit the camera
    if (dev.hasTouch) {
      await page.evaluate(() => window.scrollTo(0, 0));
      const cx = viewer.x + viewer.width / 2;
      const y0 = viewer.y + viewer.height * 0.8;
      const cdp = await page.context().newCDPSession(page);
      const swipe = async (from, to) => {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx, y: from }] });
        for (let k = 1; k <= 8; k++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: cx, y: from + ((to - from) * k) / 8 }] });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      };
      await swipe(y0, y0 - viewer.height * 0.6);
      await page.waitForTimeout(400);
      const scrolled = await page.evaluate(() => window.scrollY);
      if (scrolled < 20) fail(ctx, `a vertical swipe over the 3D viewer did not scroll the page (scrollY ${scrolled})`);
      await cdp.detach();
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    if (shots) await page.screenshot({ path: path.join(out, `${name}-${mode}-before.png`), fullPage: true });
    // run the (mocked) analysis and check the result panels
    await page.click('button:has-text("Analyze")');
    await page.waitForFunction(() => window.__worldsim !== undefined, null, { timeout: 30000 });
    const result = await page.evaluate(() => window.__worldsim);
    if (!result || result.error) fail(ctx, `analysis failed: ${result?.error}`);
    if (result && result.score < 99) fail(ctx, `mocked analysis scored ${result.score} (the mock returns the truth)`);
    await page.waitForTimeout(500);
    await audit(page, `${ctx} after`, vw);
    // open every details panel and audit again (tables, JSON, transcript)
    const details = page.locator("details");
    for (let i = 0; i < (await details.count()); i++) await details.nth(i).evaluate((d) => (d.open = true));
    await page.waitForTimeout(300);
    await audit(page, `${ctx} expanded`, vw);
    const scoreCard = page.getByText("Score", { exact: true }).first();
    if (!(await scoreCard.isVisible())) fail(ctx, "score card not visible");
    if (shots) await page.screenshot({ path: path.join(out, `${name}-${mode}-after.png`), fullPage: true });
    // a fresh room clears the result
    await page.click('button:has-text("Refresh room")');
    await page.waitForFunction(() => window.__worldsim === undefined, null, { timeout: 10000 });
  }
  for (const e of errors) fail(name, `page error: ${e}`);
  await browser.close();
}

for (const device of VIEWPORTS) {
  const before = failures.length;
  await run(device);
  console.log(`${device.name.padEnd(22)} ${device.viewport.width}x${device.viewport.height}  ${failures.length - before === 0 ? "ok" : `${failures.length - before} problem(s)`}`);
}
if (failures.length) {
  console.error("\nMOBILE CHECK FAILED:\n - " + failures.join("\n - "));
  process.exit(1);
}
console.log("\nmobile check passed");
