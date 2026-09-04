"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { renderFeeds, type Feeds } from "@/lib/feeds";
import { ALLOWED_MODELS, DEFAULT_MODEL, type ModelId } from "@/lib/models";
import { generateRoom } from "@/lib/room";
import { guessToSceneObjects } from "@/lib/scene";
import { scoreGuess } from "@/lib/score";
import type { Guess, Room, Score } from "@/lib/types";

import RoomViewer from "@/components/RoomViewer";
import { stripIds } from "@/lib/room";

interface RoundResult {
  round: number;
  guess: Guess;
  score: Score;
  notes: string;
  durationMs: number;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  guessFeeds: Feeds;
}

type Effort = "low" | "medium" | "high";

export default function App() {
  const [room, setRoom] = useState<Room>(() => generateRoom());
  const [feeds, setFeeds] = useState<Feeds | null>(null);
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL);
  const [effort, setEffort] = useState<Effort>("medium");
  const [rounds, setRounds] = useState(1);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<RoundResult[]>([]);
  const [showGuess, setShowGuess] = useState(true);
  const [showTruth, setShowTruth] = useState(true);
  const [seedInput, setSeedInput] = useState(() => String(room.seed));
  const abortRef = useRef(false);

  const refresh = useCallback((seed?: number) => {
    const r = generateRoom(seed);
    setRoom(r);
    setFeeds(null);
    setResults([]);
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
    if (!room || !feeds || running) return;
    setRunning(true);
    setError(null);
    setResults([]);
    abortRef.current = false;
    const publicRoom = { cameras: room.cameras, colors: room.colors };
    // Unaltered camera renders only: no overlays, no markers.
    const images = feeds;
    let previousResponseId: string | undefined;
    let previousGuess: Guess | undefined;
    let guessImages: Feeds | undefined;
    const collected: RoundResult[] = [];
    try {
      for (let round = 1; round <= rounds; round++) {
        if (abortRef.current) break;
        setStatus(`Round ${round}/${rounds}: asking ${model}…`);
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model,
            reasoningEffort: effort,
            room: publicRoom,
            images,
            round,
            previousResponseId,
            previousGuess,
            guessImages,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        let guess: Guess = data.guess;
        let fallbackNote = "";
        if (round > 1 && previousGuess && guess.objects.length === 0) {
          // The model bailed out of the refinement; keep its previous reconstruction.
          guess = previousGuess;
          fallbackNote = "[Model returned no objects this round; previous guess kept.]\n\n";
        }
        const score = scoreGuess(room, guess);
        // Render the guess from the same cameras for the next round (and for display).
        const rawGuessFeeds = renderFeeds(room, guessToSceneObjects(guess));
        guessImages = rawGuessFeeds;
        const rr: RoundResult = {
          round,
          guess,
          score,
          notes: fallbackNote + data.notes,
          durationMs: data.durationMs,
          usage: data.usage,
          guessFeeds: rawGuessFeeds,
        };
        collected.push(rr);
        setResults([...collected]);
        previousResponseId = data.responseId;
        previousGuess = guess;
        if (score.exact) {
          setStatus(`Exact match after round ${round}.`);
          break;
        }
        setStatus(`Round ${round}: score ${score.total}%`);
      }
      if (!abortRef.current && collected.length && !collected[collected.length - 1].score.exact) {
        setStatus(`Finished ${collected.length} round(s). Final score ${collected[collected.length - 1].score.total}%`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("");
    } finally {
      setRunning(false);
    }
  }, [room, feeds, running, rounds, model, effort]);

  const latest = results[results.length - 1];
  const guessObjects = useMemo(() => (latest && showGuess ? guessToSceneObjects(latest.guess) : null), [latest, showGuess]);
  const displayedFeeds = feeds;

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
                setStatus("Stopping after this round…");
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
            {latest && " · wireframes = model's guess"}
          </div>
          {latest && (
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
              {displayedFeeds ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={displayedFeeds[id]} alt={`Camera ${id}`} className="block aspect-[4/3] w-full" />
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
        <label className="flex items-center gap-2">
          <span className="opacity-70">Rounds</span>
          <input
            type="number"
            min={1}
            max={5}
            value={rounds}
            onChange={(e) => setRounds(Math.max(1, Math.min(5, Number(e.target.value) || 1)))}
            className="w-14 rounded border border-neutral-400/40 bg-transparent px-2 py-1"
            disabled={running}
          />
          <span className="text-xs opacity-60">(optional: from round 2 the model also gets a render of its own guess to compare against the real feeds)</span>
        </label>
        {status && <span className="ml-auto font-medium">{status}</span>}
      </section>

      {error && <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}

      {results.length > 0 && (
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {results.map((r) => (
              <div
                key={r.round}
                className={`rounded-lg border px-3 py-2 text-sm ${
                  r.score.exact ? "border-emerald-500 bg-emerald-500/10" : "border-neutral-400/30"
                }`}
              >
                <div className="text-xs opacity-60">Round {r.round}</div>
                <div className="text-2xl font-semibold">{r.score.total}%</div>
                <div className="text-xs opacity-60">
                  {r.score.countGuess} guessed / {r.score.countTruth} actual · {(r.durationMs / 1000).toFixed(1)}s
                  {r.usage?.total_tokens ? ` · ${r.usage.total_tokens} tok` : ""}
                </div>
              </div>
            ))}
          </div>

          {latest && <Comparison room={room} result={latest} />}

          <details className="rounded-lg border border-neutral-400/30 p-3 text-sm">
            <summary className="cursor-pointer font-medium">Model notes (round {latest.round})</summary>
            <pre className="mt-2 whitespace-pre-wrap font-mono text-xs opacity-80">{latest.notes}</pre>
          </details>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <details className="rounded-lg border border-neutral-400/30 p-3 text-sm">
              <summary className="cursor-pointer font-medium">Ground-truth JSON</summary>
              <pre className="mt-2 overflow-x-auto font-mono text-xs opacity-80">
                {JSON.stringify({ objects: stripIds(room.objects) }, null, 2)}
              </pre>
            </details>
            <details className="rounded-lg border border-neutral-400/30 p-3 text-sm">
              <summary className="cursor-pointer font-medium">Model JSON (round {latest.round})</summary>
              <pre className="mt-2 overflow-x-auto font-mono text-xs opacity-80">{JSON.stringify(latest.guess, null, 2)}</pre>
            </details>
          </div>

          <details className="rounded-lg border border-neutral-400/30 p-3 text-sm">
            <summary className="cursor-pointer font-medium">Render of the model&apos;s guess (what round {latest.round + 1} would see)</summary>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(["A", "B"] as const).map((id) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={id} src={latest.guessFeeds[id]} alt={`Guess from camera ${id}`} className="w-full rounded" />
              ))}
            </div>
          </details>
        </section>
      )}

      {!results.length && (
        <details className="rounded-lg border border-neutral-400/30 p-3 text-sm">
          <summary className="cursor-pointer font-medium">Ground-truth JSON</summary>
          <pre className="mt-2 overflow-x-auto font-mono text-xs opacity-80">
            {JSON.stringify({ objects: stripIds(room.objects) }, null, 2)}
          </pre>
        </details>
      )}
    </main>
  );
}

function Comparison({ room, result }: { room: Room; result: RoundResult }) {
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
            const matchedIdx = d.matched && d.guessIndex != null ? d.guessIndex : -1;
            const g = matchedIdx >= 0 ? guess.objects[matchedIdx] : null;
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
