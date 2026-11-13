import type { SpendLimits } from "./spend-limit";

/**
 * Spend limits for the public site (each Analyze run spends the owner's OpenAI credit).
 * Measured cost of one default run (gpt-5-mini, low effort): about $0.032 = ~6,300 tokens
 * ($0.25 in / $2.00 out per 1M) + one $0.03 code-interpreter session (bench/BENCH.md, OpenAI pricing 2026-11-12).
 * Each run reserves a conservative estimate; the day's total is capped at DAILY_CEILING_USD.
 * Change the numbers here or with the env vars of the same name on Vercel.
 */
export const SPEND_LIMITS: SpendLimits = {
  dailyCeilingUsd: Number(process.env.DAILY_CEILING_USD ?? 2),
  perVisitorRuns: Number(process.env.PER_VISITOR_RUNS ?? 3),
};
/** Reserved per run: low effort ~$0.032 measured; medium/high effort or gpt-5.4-mini can use 2-3x the tokens. */
export function runEstimateUsd(model: string, effort: string | undefined): number {
  const heavy = model === "gpt-5.4-mini" || (model.startsWith("gpt-5") && effort !== "low");
  return heavy ? 0.1 : 0.05;
}
