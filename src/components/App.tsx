"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RoomViewer from "@/components/RoomViewer";
import { renderFeeds, type Feeds } from "@/lib/feeds";
import { ALLOWED_MODELS, DEFAULT_MODEL, type ModelId } from "@/lib/models";
import { generateRoom, stripIds } from "@/lib/room";
import { guessToSceneObjects } from "@/lib/scene";
import { scoreGuess } from "@/lib/score";
import type { Guess, Room, Score } from "@/lib/types";

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
const POLL_MS = 3000;

export default function App() {
  const [room, setRoom] = useState<Room>(() => generateRoom());
  const [feeds, setFeeds] = useState<Feeds | null>(null);
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL);
  const [effort, setEffort] = useState<Effort>("medium");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [liveRuns, setLiveRuns] = useState<CodeRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [showGuess, setShowGuess] = useState(true);
  const [showTruth, setShowTruth] = useState(true);
  const [seedInput, setSeedInput] = useState(() => String(room.seed));
  const abortRef = useRef(false);

  const refresh = useCallback((seed?: number) => {
    const r = generateRoom(seed);
    setRoom(r);
    setFeeds(null);
    setResult(null);
    setLiveRuns([]);
    setError(null);
    setStatus("");
    setSeedInput(String(r.seed));
  }, []);

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
          room: { cameras: room.cameras, colors: room.colors },
          // Unaltered camera renders only: no overlays, no markers.
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
        const guessFeeds = renderFeeds(room, guessToSceneObjects(guess));
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
        return;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("");
    } finally {
      setRunning(false);
    }
  }, [feeds, running, room, model, effort]);

  const guessObjects = useMemo(() => (result && showGuess ? guessToSceneObjects(result.guess) : null), [result, showGuess]);
  const runsToShow = result?.codeRuns ?? liveRuns;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 p-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">World Sim</h1>
          <p className="text-sm opacity-70">
            Can a cheap vision LLM rebuild a 3D room from two camera feeds? Objects rest on the floor of a 1×1×1 room; the
            model must return the exact JSON.
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
        <div className="relative h-[420px] overflow-hidden rounded-lg border border-neutral-400/30 bg-neutral-900 lg:col-span-2 lg:h-[520px]">
          <RoomViewer room={room} guess={guessObjects} showTruth={showTruth} />
          <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/50 px-2 py-1 text-xs text-white">
            Drag to rotate · scroll to zoom · A/B are the fixed cameras
            {result && " · wireframes = model's guess"}
          </div>
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
        <div className="flex flex-col gap-3">
          {(["A", "B"] as const).map((id) => (
            <figure key={id} className="overflow-hidden rounded-lg border border-neutral-400/30 bg-black">
              {feeds ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={feeds[id]} alt={`Camera ${id}`} className="block aspect-[4/3] w-full" />
              ) : (
                <div className="aspect-[4/3] w-full" />
              )}
              <figcaption className="flex items-center justify-between px-2 py-1 text-xs">
                <span className="font-medium">Camera {id}</span>
                <span className="font-mono opacity-60">
                  pos [{room.cameras[id === "A" ? 0 : 1].position.join(", ")}] fov {room.cameras[id === "A" ? 0 : 1].fov}°
                </span>
              </figcaption>
            </figure>
          ))}
          <p className="text-xs opacity-60">The model receives exactly these two images, unaltered.</p>
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-4 rounded-lg border border-neutral-400/30 p-3 text-sm">
        <label className="flex items-center gap-2">
          <span className="opacity-70">Model</span>
          <select
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
        <span className="text-xs opacity-60">
          The model runs its guess → render → compare → re-guess loop itself, in a Python sandbox, within one response.
        </span>
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
            </div>
            {!result.usedSandbox && (
              <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                The model answered without running any code in its sandbox. The gpt-5 family reliably uses it.
              </div>
            )}
          </div>

          <Comparison room={room} result={result} />

          <details className="rounded-lg border border-neutral-400/30 p-3 text-sm">
            <summary className="cursor-pointer font-medium">Model notes</summary>
            <pre className="mt-2 whitespace-pre-wrap font-mono text-xs opacity-80">{result.notes}</pre>
          </details>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <details className="rounded-lg border border-neutral-400/30 p-3 text-sm">
              <summary className="cursor-pointer font-medium">Ground-truth JSON</summary>
              <pre className="mt-2 overflow-x-auto font-mono text-xs opacity-80">{JSON.stringify({ objects: stripIds(room.objects) }, null, 2)}</pre>
            </details>
            <details className="rounded-lg border border-neutral-400/30 p-3 text-sm">
              <summary className="cursor-pointer font-medium">Model JSON</summary>
              <pre className="mt-2 overflow-x-auto font-mono text-xs opacity-80">{JSON.stringify(result.guess, null, 2)}</pre>
            </details>
          </div>

          <details className="rounded-lg border border-neutral-400/30 p-3 text-sm">
            <summary className="cursor-pointer font-medium">Render of the model&apos;s guess from the two cameras (for you, not the model)</summary>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(["A", "B"] as const).map((id) => (
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
          <pre className="mt-2 overflow-x-auto font-mono text-xs opacity-80">{JSON.stringify({ objects: stripIds(room.objects) }, null, 2)}</pre>
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
            <th className="px-2 py-1">Matched guess</th>
            <th className="px-2 py-1">Shape</th>
            <th className="px-2 py-1">Color</th>
            <th className="px-2 py-1">Size err</th>
            <th className="px-2 py-1">Pos err</th>
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
                <td className="px-2 py-1">{(d.points * 100).toFixed(0)}</td>
              </tr>
            );
          })}
          {score.extraGuesses > 0 && (
            <tr className="border-t border-neutral-400/20">
              <td className="px-2 py-1 text-red-400" colSpan={7}>
                {score.extraGuesses} extra object(s) guessed that do not exist (penalised).
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
