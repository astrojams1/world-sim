import { createHash } from "node:crypto";
import { BlobPreconditionFailedError, get, put } from "@vercel/blob";
import { memoryStore, utcDay, type DayLedger, type LedgerStore } from "./spend-limit";

/** Vercel Blob store (private, connected to the project; BLOB_READ_WRITE_TOKEN is injected by Vercel). */
export function blobStore(PREFIX = "spend"): LedgerStore {
  return {
    async read(day) {
      const res = await get(`${PREFIX}/${day}.json`, { access: "private", useCache: false });
      if (!res || res.statusCode !== 200) return { ledger: null, version: null };
      const text = await new Response(res.stream).text();
      return { ledger: JSON.parse(text) as DayLedger, version: res.blob.etag };
    },
    async write(day, ledger, version) {
      try {
        await put(`${PREFIX}/${day}.json`, JSON.stringify(ledger), {
          access: "private",
          contentType: "application/json",
          addRandomSuffix: false,
          cacheControlMaxAge: 60,
          ...(version ? { ifMatch: version } : { allowOverwrite: false }),
        });
        return true;
      } catch (err) {
        // ifMatch mismatch, or another request created the day's file first: re-read and retry.
        if (err instanceof BlobPreconditionFailedError) return false;
        if (!version && err instanceof Error && /already exists/i.test(err.message)) return false;
        throw err;
      }
    },
  };
}

const localStores = new Map<string, LedgerStore>();

/**
 * The store for this deployment. Production without a store fails closed (every paid run is refused with
 * the friendly message) rather than spending without a limit; local development uses memory.
 */
export function spendStore(prefix = "spend"): LedgerStore | null {
  if (process.env.BLOB_READ_WRITE_TOKEN) return blobStore(prefix);
  if (process.env.VERCEL_ENV === "production") return null;
  if (!localStores.has(prefix)) localStores.set(prefix, memoryStore());
  return localStores.get(prefix)!;
}

/** A visitor key: SHA-256 of the client IP and the UTC day. The raw IP is never stored. */
export function visitorKey(headers: Headers, now: Date = new Date()): string {
  const ip =
    headers.get("x-real-ip") ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? headers.get("cf-connecting-ip") ?? "unknown";
  return createHash("sha256").update(`${ip}|${utcDay(now)}`).digest("hex").slice(0, 16);
}
