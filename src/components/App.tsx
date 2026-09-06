"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RoomViewer from "@/components/RoomViewer";
import { feedIds, feedInfo, renderFeeds, type FeedId, type Feeds } from "@/lib/feeds";
import { ALLOWED_MODELS, DEFAULT_MODEL, type ModelId } from "@/lib/models";
import { generateRoom, groundTruth, maxObjects, MIN_OBJECTS, SNAPSHOT_INTERVAL } from "@/lib/room";
import { guessToContent } from "@/lib/scene";
import { scoreGuess } from "@/lib/score";
import { MODES, type Guess, type Mode, type Room, type Score } from "@/lib/types";

interface CodeRun {
  code: string | null;
  logs: string;
  status: string;
}

interface AnalysisResult {
  guess: Guess;
  score: Score;
  notes: string;
  durationMs: number;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  codeRuns: CodeRun[];
  sessionLog: string;
  usedSandbox: boolean;
  guessFeeds: Feeds;
}

type Effort = "low" | "medium" | "high";
const POLL_MS = 1000;

declare global {
  interface Window {
    /** Last analysis result, exposed for the benchmark script. */
    __worldsim?: {
      seed: number;
      mode: Mode;
      objects?: number;
      objectCount?: number | null;
      model: string;
      effort: string;
      score: number;
      exact: boolean;
      durationMs: number;
      usage?: unknown;
      codeRuns: number;
      usedSandbox: boolean;
      guess: Guess;
      truth: unknown;
      error?: string;
      notes?: string;
      sessionLog?: string;
      codeCells?: string[];
    };
  }
}

export default function App() {
  const [mode, setMode] = useState<Mode>("static");
  const [room, setRoom] = useState<Room>(() => generateRoom());
  const [feeds, setFeeds] = useState<Feeds | null>(null);
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL);
  const [effort, setEffort] = useState<Effort>("low");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [liveRuns, setLiveRuns] = useState<CodeRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [showGuess, setShowGuess] = useState(true);
  const [showTruth, setShowTruth] = useState(true);
  const [seedInput, setSeedInput] = useState(() => String(room.seed));
  // "auto" draws 2-5 objects (the historical rooms); a number fixes the count (the capacity dimension).
  const [objectCount, setObjectCount] = useState<"auto" | number>("auto");
  const abortRef = useRef(false);

  const refresh = useCallback((seed?: number, count: "auto" | number = objectCount, m: Mode = mode) => {
    const r = generateRoom(seed, count === "auto" ? undefined : count, m);
    setRoom(r);
    setFeeds(null);
    setResult(null);
    setLiveRuns([]);
    setError(null);
    setStatus("");
    setSeedInput(String(r.seed));
    window.__worldsim = undefined;
  }, [objectCount, mode]);

  // Render feeds whenever the room changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const raw = renderFeeds(room);
      if (!cancelled) setFeeds(raw);
    })();
    return () => {
      cancelled = true;
    };
  }, [room]);

  const analyze = useCallback(async () => {
    if (!feeds || running) return;
    setRunning(true);
    setError(null);
    setResult(null);
    setLiveRuns([]);
    abortRef.current = false;
    const started = Date.now();
    try {
      setStatus(`Uploading feeds to ${model}'s sandbox…`);
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          reasoningEffort: effort,
          // The mode selects the fixed prompt; the unaltered camera renders are the only room data sent.
          mode: room.mode,
          images: feeds,
        }),
      });
      const start = await res.json();
      if (!res.ok) throw new Error(start.error ?? `HTTP ${res.status}`);
      const id: string = start.responseId;

      // Poll until the background response finishes.
      for (;;) {
        if (abortRef.current) {
          setStatus("Stopped. (The model may still finish in the background.)");
          return;
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
        const pollRes = await fetch(`/api/analyze?id=${encodeURIComponent(id)}`);
        const data = await pollRes.json();
        if (data.codeRuns) setLiveRuns(data.codeRuns);
        if (data.status === "queued" || data.status === "in_progress") {
          const secs = Math.round((Date.now() - started) / 1000);
          setStatus(`${model} is working in its sandbox… ${data.codeRuns?.length ?? 0} code run(s), ${secs}s`);
          continue;
        }
        if (!pollRes.ok) throw new Error(data.error ?? `HTTP ${pollRes.status}`);
        const guess: Guess = data.guess;
        const score = scoreGuess(room, guess);
        const guessFeeds = renderFeeds(room, guessToContent(guess));
        setResult({
          guess,
          score,
          notes: data.notes,
          durationMs: Date.now() - started,
          usage: data.usage,
          codeRuns: data.codeRuns ?? [],
          sessionLog: data.sessionLog ?? "",
          usedSandbox: Boolean(data.usedSandbox),
          guessFeeds,
        });
        setStatus(score.exact ? "Exact match." : `Score ${score.total}%`);
        window.__worldsim = {
          seed: room.seed,
          mode: room.mode,
          objects: room.objects.length,
          objectCount: room.objectCount ?? null,
          model,
          effort,
          score: score.total,
          exact: score.exact,
          durationMs: Date.now() - started,
          usage: data.usage,
          codeRuns: (data.codeRuns ?? []).length,
          usedSandbox: Boolean(data.usedSandbox),
          guess,
          truth: groundTruth(room),
          notes: data.notes,
          sessionLog: data.sessionLog ?? "",
          codeCells: (data.codeRuns ?? []).map((c: CodeRun) => c.code ?? ""),
        };
        return;
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      setStatus("");
      window.__worldsim = {
        seed: room.seed,
        mode: room.mode,
        objects: room.objects.length,
        objectCount: room.objectCount ?? null,
        model,
        effort,
        score: 0,
        exact: false,
        durationMs: Date.now() - started,
        codeRuns: 0,
        usedSandbox: false,
        guess: { objects: [] },
        truth: groundTruth(room),
        error: message,
      };
    } finally {
      setRunning(false);
    }
  }, [feeds, running, room, model, effort]);

  const guessContent = useMemo(() => (result && showGuess ? guessToContent(result.guess) : null), [result, showGuess]);
  const ids = feedIds(room);
  const runsToShow = result?.codeRuns ?? liveRuns;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 p-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">World Sim</h1>
          <p className="text-sm opacity-70">
            {room.mode === "platform"
              ? `Mode 2, moving platform: red and blue spheres and cubes ride a green conveyor platform of any orientation through a 1×1×1 room; each camera takes two snapshots ${SNAPSHOT_INTERVAL} s apart and the model gets only the four images. It must return the platform's position, normal and velocity and every object at the first snapshot.`
              : "Mode 1, static room: can a cheap vision LLM rebuild a 3D room from two camera feeds? Red and blue spheres and cubes float in a 1×1×1 room; the model gets only the two images and must return the exact JSON."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-1">
            <span className="opacity-70">Seed</span>
            <input
              className="w-28 rounded border border-neutral-400/40 bg-transparent px-2 py-1 font-mono text-xs"
              value={seedInput}
              onChange={(e) => setSeedInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const n = Number(seedInput);
                  if (Number.isFinite(n)) refresh(n);
                }
              }}
            />
          </label>
          <label className="flex items-center gap-1">
            <span className="opacity-70">Mode</span>
            <select
              aria-label="Mode"
              className="rounded border border-neutral-400/40 bg-transparent px-2 py-1 text-xs"
              value={mode}
              onChange={(e) => {
                const m = e.target.value as Mode;
                setMode(m);
                const count = objectCount === "auto" || objectCount <= maxObjects(m) ? objectCount : "auto";
                setObjectCount(count);
                const n = Number(seedInput);
                refresh(Number.isFinite(n) ? n : undefined, count, m);
              }}
              disabled={running}
            >
              {MODES.map((m) => (
                <option key={m} value={m} className="text-black">
                  {m === "static" ? "1 · static room" : "2 · moving platform"}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1">
            <span className="opacity-70">Objects</span>
            <select
              aria-label="Objects"
              className="rounded border border-neutral-400/40 bg-transparent px-2 py-1 text-xs"
              value={String(objectCount)}
              onChange={(e) => {
                const v = e.target.value === "auto" ? "auto" : Number(e.target.value);
                setObjectCount(v);
                const n = Number(seedInput);
                refresh(Number.isFinite(n) ? n : undefined, v);
              }}
              disabled={running}
            >
              <option value="auto" className="text-black">{mode === "platform" ? "auto (2-4)" : "auto (2-5)"}</option>
              {Array.from({ length: maxObjects(mode) - MIN_OBJECTS + 1 }, (_, i) => MIN_OBJECTS + i).map((n) => (
                <option key={n} value={String(n)} className="text-black">
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button
            className="rounded bg-neutral-700 px-3 py-1.5 text-white hover:bg-neutral-600 disabled:opacity-50"
            onClick={() => refresh()}
            disabled={running}
          >
            Refresh room
          </button>
          <button
            className="rounded bg-emerald-600 px-3 py-1.5 font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            onClick={analyze}
            disabled={running || !feeds}
          >
            {running ? "Analyzing…" : "Analyze"}
          </button>
          {running && (
            <button
              className="rounded border border-neutral-400/40 px-3 py-1.5 hover:bg-neutral-500/10"
              onClick={() => {
                abortRef.current = true;
              }}
            >
              Stop
            </button>
          )}
        </div>
      </header>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="relative h-[360px] overflow-hidden rounded-lg border border-neutral-400/30 bg-neutral-900 lg:col-span-2 lg:h-auto lg:self-stretch">
          <RoomViewer room={room} guess={guessContent} showTruth={showTruth} />
          {result && (
            <div className="absolute right-2 top-2 flex gap-2 rounded bg-black/50 px-2 py-1 text-xs text-white">
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={showTruth} onChange={(e) => setShowTruth(e.target.checked)} /> truth
              </label>
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={showGuess} onChange={(e) => setShowGuess(e.target.checked)} /> guess
              </label>
            </div>
          )}
        </div>
        <div className={`grid gap-3 ${ids.length > 2 ? "grid-cols-2" : "grid-cols-1"}`}>
          {ids.map((id) => {
            const { camera, t } = feedInfo(id);
            const spec = room.cameras[camera === "A" ? 0 : 1];
            return (
              <figure key={id} className="overflow-hidden rounded-lg border border-neutral-400/30 bg-black">
                {feeds?.[id] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={feeds[id]} alt={`Camera ${id}`} className="block aspect-[4/3] w-full" />
                ) : (
                  <div className="aspect-[4/3] w-full" />
                )}
                <figcaption className="flex items-center justify-between gap-2 px-2 py-1 text-xs">
                  <span className="whitespace-nowrap font-medium">
                    Camera {camera}
                    {room.mode === "platform" ? ` · t = ${t} s` : ""}
                  </span>
                  <span className="truncate font-mono opacity-60">
                    pos [{spec.position.join(", ")}] fov {spec.fov}°
                  </span>
                </figcaption>
              </figure>
            );
          })}
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-4 rounded-lg border border-neutral-400/30 p-3 text-sm">
        <label className="flex items-center gap-2">
          <span className="opacity-70">Model</span>
          <select
            aria-label="Model"
            className="rounded border border-neutral-400/40 bg-transparent px-2 py-1"
            value={model}
            onChange={(e) => setModel(e.target.value as ModelId)}
            disabled={running}
          >
            {ALLOWED_MODELS.map((m) => (
              <option key={m} value={m} className="text-black">
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="opacity-70">Reasoning</span>
          <select
            aria-label="Reasoning"
            className="rounded border border-neutral-400/40 bg-transparent px-2 py-1"
            value={effort}
            onChange={(e) => setEffort(e.target.value as Effort)}
            disabled={running || !model.startsWith("gpt-5")}
          >
            <option value="low" className="text-black">low</option>
            <option value="medium" className="text-black">medium</option>
            <option value="high" className="text-black">high</option>
          </select>
        </label>
        {status && <span className="ml-auto font-medium">{status}</span>}
      </section>

      {error && <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}

      {result && (
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            <div
              className={`rounded-lg border px-3 py-2 text-sm ${
                result.score.exact ? "border-emerald-500 bg-emerald-500/10" : "border-neutral-400/30"
              }`}
            >
              <div className="text-xs opacity-60">Score</div>
              <div className="text-2xl font-semibold">{result.score.total}%</div>
              <div className="text-xs opacity-60">
                {result.score.countGuess} guessed / {result.score.countTruth} actual · {(result.durationMs / 1000).toFixed(0)}s ·{" "}
                {result.codeRuns.length} code run(s)
                {result.usage?.total_tokens ? ` · ${result.usage.total_tokens} tok` : ""}
              </div>
              <div className="text-xs opacity-60">scored in room frame {result.score.symmetry} (frame-invariant)</div>
            </div>
            {!result.usedSandbox && (
              <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                The model answered without running any code in its sandbox. The gpt-5 family reliably uses it.
              </div>
            )}
          </div>

          <Comparison room={room} result={result} />
          {room.platform && <PlatformComparison room={room} result={result} />}

          <details className="rounded-lg border border-neutral-400/30 p-3 text-sm">
            <summary className="cursor-pointer font-medium">Model notes</summary>
            <pre className="mt-2 whitespace-pre-wrap font-mono text-xs opacity-80">{result.notes}</pre>
          </details>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <details className="rounded-lg border border-neutral-400/30 p-3 text-sm">
              <summary className="cursor-pointer font-medium">Ground-truth JSON</summary>
              <pre className="mt-2 overflow-x-auto font-mono text-xs opacity-80">{JSON.stringify(groundTruth(room), null, 2)}</pre>
            </details>
            <details className="rounded-lg border border-neutral-400/30 p-3 text-sm">
              <summary className="cursor-pointer font-medium">Model JSON</summary>
              <pre className="mt-2 overflow-x-auto font-mono text-xs opacity-80">{JSON.stringify(result.guess, null, 2)}</pre>
            </details>
          </div>

          <details className="rounded-lg border border-neutral-400/30 p-3 text-sm">
            <summary className="cursor-pointer font-medium">Render of the model&apos;s guess from the cameras (for you, not the model)</summary>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {ids.map((id: FeedId) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={id} src={result.guessFeeds[id]} alt={`Guess from camera ${id}`} className="w-full rounded" />
              ))}
            </div>
          </details>
        </section>
      )}

      {runsToShow.length > 0 && <CodeRuns runs={runsToShow} live={!result} sessionLog={result?.sessionLog ?? ""} />}

      {!result && (
        <details className="rounded-lg border border-neutral-400/30 p-3 text-sm">
          <summary className="cursor-pointer font-medium">Ground-truth JSON</summary>
          <pre className="mt-2 overflow-x-auto font-mono text-xs opacity-80">{JSON.stringify(groundTruth(room), null, 2)}</pre>
        </details>
      )}
    </main>
  );
}

function CodeRuns({ runs, live, sessionLog }: { runs: CodeRun[]; live: boolean; sessionLog: string }) {
  return (
    <details className="rounded-lg border border-neutral-400/30 p-3 text-sm" open={live}>
      <summary className="cursor-pointer font-medium">
        Model&apos;s Python session ({runs.length} run{runs.length === 1 ? "" : "s"}){live ? " · live" : ""}
      </summary>
      <div className="mt-2 flex flex-col gap-3">
        <p className="text-xs opacity-60">
          The code of every run, in order. The API does not return per-run output for background responses, so the full
          printed transcript of the session is shown below the code.
        </p>
        {runs.map((r, i) => (
          <div key={i} className="rounded border border-neutral-400/20">
            <div className="flex items-center justify-between bg-neutral-500/10 px-2 py-1 text-xs">
              <span>Run {i + 1}</span>
              <span className="opacity-60">{r.status}</span>
            </div>
            <pre className="max-h-64 overflow-auto px-2 py-1 font-mono text-[11px] leading-snug text-sky-200/90">{r.code ?? ""}</pre>
            {r.logs && (
              <pre className="max-h-64 overflow-auto border-t border-neutral-400/20 px-2 py-1 font-mono text-[11px] leading-snug opacity-80">
                {r.logs}
              </pre>
            )}
          </div>
        ))}
        {sessionLog && (
          <div className="rounded border border-neutral-400/20">
            <div className="bg-neutral-500/10 px-2 py-1 text-xs">Session transcript (everything the model printed)</div>
            <pre className="max-h-[32rem] overflow-auto px-2 py-1 font-mono text-[11px] leading-snug opacity-80">{sessionLog}</pre>
          </div>
        )}
      </div>
    </details>
  );
}

function Comparison({ room, result }: { room: Room; result: AnalysisResult }) {
  const { score, guess } = result;
  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-400/30">
      <table className="w-full text-left text-xs">
        <thead className="bg-neutral-500/10">
          <tr>
            <th className="px-2 py-1">Actual object</th>
            <th className="px-2 py-1">Matched guess (model&apos;s frame)</th>
            <th className="px-2 py-1">Shape</th>
            <th className="px-2 py-1">Color</th>
            <th className="px-2 py-1">Size err</th>
            <th className="px-2 py-1">Pos err</th>
            <th className="px-2 py-1">Orient err</th>
            <th className="px-2 py-1">Points</th>
          </tr>
        </thead>
        <tbody>
          {score.details.map((d, i) => {
            const t = room.objects[i];
            const g = d.matched && d.guessIndex != null ? guess.objects[d.guessIndex] : null;
            const ok = (b?: boolean) => (b ? "text-emerald-400" : "text-red-400");
            return (
              <tr key={t.id} className="border-t border-neutral-400/20 font-mono">
                <td className="px-2 py-1">
                  {t.color} {t.shape} {t.size} @ [{t.position.join(", ")}]
                </td>
                <td className="px-2 py-1">
                  {g ? `${g.color} ${g.shape} ${g.size} @ [${g.position.map((v) => +v.toFixed(3)).join(", ")}]` : <span className="text-red-400">missing</span>}
                </td>
                <td className={`px-2 py-1 ${ok(d.shapeOk)}`}>{d.matched ? (d.shapeOk ? "✓" : "✗") : "–"}</td>
                <td className={`px-2 py-1 ${ok(d.colorOk)}`}>{d.matched ? (d.colorOk ? "✓" : "✗") : "–"}</td>
                <td className="px-2 py-1">{d.matched ? d.sizeError?.toFixed(3) : "–"}</td>
                <td className="px-2 py-1">{d.matched ? d.positionError?.toFixed(3) : "–"}</td>
                <td className="px-2 py-1">
                  {t.shape !== "cube" ? "n/a" : d.orientationError === undefined ? <span className="text-red-400">none</span> : `${d.orientationError.toFixed(1)}°`}
                </td>
                <td className="px-2 py-1">{(d.points * 100).toFixed(0)}</td>
              </tr>
            );
          })}
          {score.extraGuesses > 0 && (
            <tr className="border-t border-neutral-400/20">
              <td className="px-2 py-1 text-red-400" colSpan={8}>
                {score.extraGuesses} extra object(s) guessed that do not exist (penalised).
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function PlatformComparison({ room, result }: { room: Room; result: AnalysisResult }) {
  const p = result.score.platform;
  const t = room.platform!;
  const g = result.guess.platform;
  const fmt = (v: readonly number[]) => `[${v.map((x) => +x.toFixed(3)).join(", ")}]`;
  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-400/30">
      <table className="w-full text-left text-xs">
        <thead className="bg-neutral-500/10">
          <tr>
            <th className="px-2 py-1">Platform</th>
            <th className="px-2 py-1">Actual</th>
            <th className="px-2 py-1">Guess (model&apos;s frame)</th>
            <th className="px-2 py-1">Error</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          <tr className="border-t border-neutral-400/20">
            <td className="px-2 py-1">position</td>
            <td className="px-2 py-1">{fmt(t.position)}</td>
            <td className="px-2 py-1">{g ? fmt(g.position) : <span className="text-red-400">missing</span>}</td>
            <td className="px-2 py-1">{p?.positionError !== undefined ? p.positionError.toFixed(3) : "–"}</td>
          </tr>
          <tr className="border-t border-neutral-400/20">
            <td className="px-2 py-1">normal</td>
            <td className="px-2 py-1">{fmt(t.normal)}</td>
            <td className="px-2 py-1">{g ? fmt(g.normal) : "–"}</td>
            <td className="px-2 py-1">{p?.normalError !== undefined ? `${p.normalError.toFixed(1)}°` : "–"}</td>
          </tr>
          <tr className="border-t border-neutral-400/20">
            <td className="px-2 py-1">velocity (units/s)</td>
            <td className="px-2 py-1">{fmt(t.velocity)}</td>
            <td className="px-2 py-1">{g ? fmt(g.velocity) : "–"}</td>
            <td className="px-2 py-1">{p?.velocityError !== undefined ? p.velocityError.toFixed(3) : "–"}</td>
          </tr>
          <tr className="border-t border-neutral-400/20">
            <td className="px-2 py-1">platform points</td>
            <td className="px-2 py-1" colSpan={3}>
              {p ? `${(p.points * 100).toFixed(0)} / 100 (30% of the total; the objects are the other 70%)` : "–"}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
