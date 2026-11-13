// Run: node --experimental-strip-types --test tests/   (Node 22)
import { test } from "node:test";
import assert from "node:assert/strict";
import { reserve, check, charge, memoryStore, utcDay } from "../src/lib/spend-limit.ts";

const day1 = new Date("2026-11-12T10:00:00Z");
const day2 = new Date("2026-11-13T00:00:01Z");
const limits = { dailyCeilingUsd: 0.2, perVisitorRuns: 3 };

test("a visitor gets perVisitorRuns runs per UTC day, then a friendly message", async () => {
  const store = memoryStore();
  for (let i = 0; i < 3; i++) assert.equal((await reserve(store, limits, "a", { usd: 0.05, run: true }, day1)).ok, true);
  const fourth = await reserve(store, limits, "a", { usd: 0.05, run: true }, day1);
  assert.equal(fourth.ok, false);
  assert.equal(fourth.reason, "visitor");
  assert.match(fourth.message, /come back tomorrow/i);
  assert.equal((await reserve(store, limits, "a", { usd: 0.05, run: true }, day2)).ok, true, "resets next UTC day");
});

test("the global dollar ceiling stops every visitor and the counter moves", async () => {
  const store = memoryStore();
  for (const v of ["a", "b", "c", "d"]) assert.equal((await reserve(store, limits, v, { usd: 0.05, run: true }, day1)).ok, true);
  const over = await reserve(store, limits, "e", { usd: 0.05, run: true }, day1);
  assert.equal(over.ok, false);
  assert.equal(over.reason, "global");
  const doc = store.docs.get(utcDay(day1)).ledger;
  assert.equal(doc.runs, 4);
  assert.equal(doc.spentUsd, 0.2);
});

test("per-visitor dollar cap and measured charges", async () => {
  const store = memoryStore();
  const l = { dailyCeilingUsd: 5, perVisitorRuns: 2, perVisitorUsd: 1 };
  assert.equal((await reserve(store, l, "a", { usd: 0, run: true }, day1)).ok, true);
  assert.equal(await charge(store, "a", 0.6, day1), true);
  assert.equal((await check(store, l, "a", 0, day1)).ok, true);
  assert.equal(await charge(store, "a", 0.5, day1), true);
  const c = await check(store, l, "a", 0, day1);
  assert.equal(c.ok, false);
  assert.equal(c.reason, "visitor");
  assert.equal((await check(store, l, "b", 0, day1)).ok, true);
});

test("concurrent reservations cannot overshoot (conditional writes)", async () => {
  const store = memoryStore();
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) => reserve(store, limits, `v${i}`, { usd: 0.05, run: true }, day1)),
  );
  const ok = results.filter((r) => r.ok).length;
  assert.ok(ok <= 4, `at most 4 runs fit in $0.20, got ${ok}`);
  assert.ok(store.docs.get(utcDay(day1)).ledger.spentUsd <= 0.2);
});

test("store failure fails closed", async () => {
  const broken = { read: async () => { throw new Error("down"); }, write: async () => true };
  const r = await reserve(broken, limits, "a", { usd: 0.05, run: true }, day1);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "unavailable");
});
