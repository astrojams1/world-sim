/**
 * Daily spend guard for endpoints that spend the owner's paid API credit.
 *
 * Two limits, both reset at 00:00 UTC:
 *  - per visitor (hashed IP): a number of runs and, optionally, a dollar amount;
 *  - global: a dollar ceiling for the whole product.
 *
 * State is one small JSON document per UTC day, kept in a store that supports conditional writes
 * (Vercel Blob with ifMatch in production), so concurrent requests cannot both take the last run.
 * This file has no imports so it can be unit-tested with plain Node.
 */

export interface VisitorUsage {
  runs: number;
  usd: number;
}

export interface DayLedger {
  day: string;
  spentUsd: number;
  runs: number;
  visitors: Record<string, VisitorUsage>;
}

export interface LedgerStore {
  /** Returns the day's ledger (or null if none yet) and a version tag for conditional writes. */
  read(day: string): Promise<{ ledger: DayLedger | null; version: string | null }>;
  /** Writes only if the stored version still equals `version` (null = must not exist yet). Returns false on a conflict. */
  write(day: string, ledger: DayLedger, version: string | null): Promise<boolean>;
}

export interface SpendLimits {
  /** Global ceiling in US dollars per UTC day. */
  dailyCeilingUsd: number;
  /** Runs one visitor may start per UTC day. */
  perVisitorRuns: number;
  /** Optional dollar cap per visitor per UTC day. */
  perVisitorUsd?: number;
}

export type LimitReason = "visitor" | "global" | "unavailable";

export type Decision =
  | { ok: true; ledger: DayLedger }
  | { ok: false; reason: LimitReason; message: string };

export const LIMIT_MESSAGES: Record<LimitReason, string> = {
  visitor: "You've used today's free runs. Come back tomorrow for more!",
  global: "Today's free runs are used up. Come back tomorrow!",
  unavailable: "Free runs are paused for a moment. Please try again later.",
};

export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function emptyLedger(day: string): DayLedger {
  return { day, spentUsd: 0, runs: 0, visitors: {} };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Why a new run (or round) costing `usd` may not start, or null if it may. */
export function blockReason(
  ledger: DayLedger,
  limits: SpendLimits,
  visitor: string,
  cost: { usd: number; run: boolean },
): LimitReason | null {
  const v = ledger.visitors[visitor] ?? { runs: 0, usd: 0 };
  if (cost.run && v.runs >= limits.perVisitorRuns) return "visitor";
  if (limits.perVisitorUsd !== undefined && v.usd + cost.usd > limits.perVisitorUsd) return "visitor";
  if (limits.perVisitorUsd !== undefined && v.usd >= limits.perVisitorUsd) return "visitor";
  if (ledger.spentUsd + cost.usd > limits.dailyCeilingUsd) return "global";
  if (ledger.spentUsd >= limits.dailyCeilingUsd) return "global";
  return null;
}

function applyCost(ledger: DayLedger, visitor: string, cost: { usd: number; run: boolean }): DayLedger {
  const v = ledger.visitors[visitor] ?? { runs: 0, usd: 0 };
  return {
    ...ledger,
    spentUsd: round6(ledger.spentUsd + cost.usd),
    runs: ledger.runs + (cost.run ? 1 : 0),
    visitors: { ...ledger.visitors, [visitor]: { runs: v.runs + (cost.run ? 1 : 0), usd: round6(v.usd + cost.usd) } },
  };
}

const MAX_ATTEMPTS = 6;

/**
 * Check the limits and, if the run may start, record it (runs + reserved dollars) in one conditional write.
 * Fails closed: if the store cannot be read or written, the run does not start.
 */
export async function reserve(
  store: LedgerStore,
  limits: SpendLimits,
  visitor: string,
  cost: { usd: number; run: boolean },
  now: Date = new Date(),
): Promise<Decision> {
  const day = utcDay(now);
  try {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const { ledger, version } = await store.read(day);
      const current = ledger ?? emptyLedger(day);
      const reason = blockReason(current, limits, visitor, cost);
      if (reason) return { ok: false, reason, message: LIMIT_MESSAGES[reason] };
      const next = applyCost(current, visitor, cost);
      if (await store.write(day, next, version)) return { ok: true, ledger: next };
    }
  } catch (err) {
    console.error("spend-limit: store error", err);
  }
  return { ok: false, reason: "unavailable", message: LIMIT_MESSAGES.unavailable };
}

/** Read-only check: may this visitor spend `usd` more today? Fails closed. */
export async function check(
  store: LedgerStore,
  limits: SpendLimits,
  visitor: string,
  usd = 0,
  now: Date = new Date(),
): Promise<Decision> {
  try {
    const { ledger } = await store.read(utcDay(now));
    const current = ledger ?? emptyLedger(utcDay(now));
    const reason = blockReason(current, limits, visitor, { usd, run: false });
    return reason ? { ok: false, reason, message: LIMIT_MESSAGES[reason] } : { ok: true, ledger: current };
  } catch (err) {
    console.error("spend-limit: store error", err);
    return { ok: false, reason: "unavailable", message: LIMIT_MESSAGES.unavailable };
  }
}

/** Add a measured cost after the fact (no limit check). Returns false if it could not be recorded. */
export async function charge(store: LedgerStore, visitor: string, usd: number, now: Date = new Date()): Promise<boolean> {
  if (!(usd > 0)) return true;
  const day = utcDay(now);
  try {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const { ledger, version } = await store.read(day);
      const next = applyCost(ledger ?? emptyLedger(day), visitor, { usd, run: false });
      if (await store.write(day, next, version)) return true;
    }
  } catch (err) {
    console.error("spend-limit: store error", err);
  }
  return false;
}

/** In-memory store for tests and local development. */
export function memoryStore(): LedgerStore & { docs: Map<string, { ledger: DayLedger; version: string }> } {
  const docs = new Map<string, { ledger: DayLedger; version: string }>();
  let n = 0;
  return {
    docs,
    async read(day) {
      const d = docs.get(day);
      return d ? { ledger: structuredClone(d.ledger), version: d.version } : { ledger: null, version: null };
    },
    async write(day, ledger, version) {
      const d = docs.get(day);
      if ((d?.version ?? null) !== version) return false;
      docs.set(day, { ledger: structuredClone(ledger), version: `v${++n}` });
      return true;
    },
  };
}
