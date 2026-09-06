"use client";

import { SNAPSHOT_INTERVAL, stripIds } from "@/lib/room";
import { NORMAL_TOL, ORI_TOL, POS_TOL, SIZE_TOL, VELOCITY_TOL } from "@/lib/score";
import type { Guess, Room, Score, Vec3 } from "@/lib/types";

/**
 * The ground truth and the model's answer side by side as JSON, object by object, in the same order and the same
 * room frame (the guess must already be aligned with alignGuessToTruth), with every value coloured by the scorer's
 * verdict: green within tolerance, red different, dim identical text. Missing and extra objects get their own
 * blocks so the two columns always line up.
 */

type Tone = "same" | "ok" | "bad" | "dim";
interface Token {
  text: string;
  tone?: Tone;
}
type Line = Token[];

const TONE: Record<Tone, string> = {
  same: "",
  ok: "text-emerald-300",
  bad: "rounded bg-red-500/20 text-red-200",
  dim: "opacity-50",
};

const num = (v: number) => (Number.isFinite(v) ? String(+v.toFixed(3)) : "?");

function vecLine(key: string, v: Vec3 | undefined, tones: Tone[] | Tone, trailing: string): Line {
  if (!v) return [{ text: `"${key}": ` }, { text: "null", tone: Array.isArray(tones) ? "bad" : tones }, { text: trailing }];
  const t = (k: number) => (Array.isArray(tones) ? tones[k] : tones);
  return [
    { text: `"${key}": [` },
    { text: num(v[0]), tone: t(0) },
    { text: ", " },
    { text: num(v[1]), tone: t(1) },
    { text: ", " },
    { text: num(v[2]), tone: t(2) },
    { text: `]${trailing}` },
  ];
}

function kv(key: string, value: string, tone: Tone, trailing = ","): Line {
  return [{ text: `"${key}": ` }, { text: value, tone }, { text: trailing }];
}

const blank = (): Line => [{ text: "" }];
const note = (text: string, tone: Tone): Line => [{ text, tone }];
const indent = (lines: Line[], level: number): Line[] => lines.map((l) => (l.length === 1 && l[0].text === "" ? l : [{ text: "  ".repeat(level) }, ...l]));

type Obj = Guess["objects"][number];

/** The seven lines of one object; `tones` says how each field of the right column compares. */
function objectLines(o: Obj, tones?: { shape: Tone; color: Tone; size: Tone; position: Tone[]; rotation: Tone }, last = false): Line[] {
  const t = tones ?? { shape: "same", color: "same", size: "same", position: ["same", "same", "same"], rotation: "same" };
  return [
    [{ text: "{" }],
    ...indent(
      [
        kv("shape", `"${o.shape}"`, t.shape),
        kv("color", `"${o.color}"`, t.color),
        kv("size", num(o.size), t.size),
        vecLine("position", o.position, t.position, ","),
        o.rotation ? vecLine("rotation", o.rotation, t.rotation, "") : kv("rotation", "null", t.rotation, ""),
      ],
      1,
    ),
    [{ text: last ? "}" : "}," }],
  ];
}

function placeholder(text: string, tone: Tone, lines = 7): Line[] {
  return [note(text, tone), ...Array.from({ length: lines - 1 }, blank)];
}

export default function JsonDiff({ room, guess, score }: { room: Room; guess: Guess; score: Score }) {
  const truth = stripIds(room.objects);
  const left: Line[] = [];
  const right: Line[] = [];
  const push = (l: Line[], r: Line[]) => {
    left.push(...l);
    right.push(...r);
  };

  push([[{ text: "{" }]], [[{ text: "{" }]]);

  if (room.platform) {
    const tp = room.platform;
    const gp = guess.platform;
    const sp = score.platform;
    const okPos: Tone = sp?.present && (sp.positionError ?? 1) <= POS_TOL ? "ok" : "bad";
    const okNrm: Tone = sp?.present && (sp.normalError ?? 180) <= NORMAL_TOL ? "ok" : "bad";
    const okVel: Tone = sp?.present && (sp.velocityError ?? 1) * SNAPSHOT_INTERVAL <= VELOCITY_TOL ? "ok" : "bad";
    const block = (pos: Line, nrm: Line, vel: Line): Line[] => [[{ text: '  "platform": {' }], ...indent([pos, nrm, vel], 2), [{ text: "  }," }]];
    push(
      block(vecLine("position", tp.position, "same", ","), vecLine("normal", tp.normal, "same", ","), vecLine("velocity", tp.velocity, "same", "")),
      gp ? block(vecLine("position", gp.position, okPos, ","), vecLine("normal", gp.normal, okNrm, ","), vecLine("velocity", gp.velocity, okVel, "")) : indent(placeholder('"platform": missing', "bad", 5), 1),
    );
  }

  push([[{ text: '  "objects": [' }]], [[{ text: '  "objects": [' }]]);
  const used = new Set<number>();
  score.details.forEach((d, i) => {
    const t = truth[i];
    const isLast = i === truth.length - 1 && score.extraGuesses === 0;
    if (!d.matched || d.guessIndex == null) {
      push(indent(objectLines(t, undefined, isLast), 2), indent(placeholder("missing: no object matched this one", "bad"), 2));
      return;
    }
    used.add(d.guessIndex);
    const g = guess.objects[d.guessIndex];
    const posTone = t.position.map((v, k) => (Math.abs(v - g.position[k]) <= POS_TOL ? "ok" : "bad")) as Tone[];
    const rotTone: Tone = t.shape === "cube" ? ((d.orientationError ?? 180) <= ORI_TOL && d.shapeOk ? "ok" : "bad") : g.rotation ? "bad" : "ok";
    push(
      indent(objectLines(t, undefined, isLast), 2),
      indent(
        objectLines(
          g,
          {
            shape: d.shapeOk ? "ok" : "bad",
            color: d.colorOk ? "ok" : "bad",
            size: (d.sizeError ?? 1) <= SIZE_TOL ? "ok" : "bad",
            position: posTone,
            rotation: rotTone,
          },
          isLast,
        ),
        2,
      ),
    );
  });
  guess.objects.forEach((g, j) => {
    if (used.has(j)) return;
    const isLast = j === guess.objects.length - 1;
    push(indent(placeholder("(no such object)", "dim"), 2), indent(objectLines(g, { shape: "bad", color: "bad", size: "bad", position: ["bad", "bad", "bad"], rotation: "bad" }, isLast), 2));
  });
  push([[{ text: "  ]" }], [{ text: "}" }]], [[{ text: "  ]" }], [{ text: "}" }]]);

  const column = (lines: Line[], title: string) => (
    <div className="min-w-0">
      <div className="mb-1 text-xs font-medium opacity-70">{title}</div>
      <pre className="max-h-[32rem] overflow-auto rounded border border-neutral-400/20 px-2 py-1 font-mono text-xs leading-5">
        {lines.map((line, i) => (
          <div key={i} className={line.length === 1 && line[0].text === "" ? "h-5" : ""}>
            {line.map((tok, k) => (
              <span key={k} className={tok.tone ? TONE[tok.tone] : ""}>
                {tok.text}
              </span>
            ))}
          </div>
        ))}
      </pre>
    </div>
  );

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-3 text-xs opacity-70">
        <span>Objects are listed in the truth&apos;s order with the model&apos;s matched object beside each; the model&apos;s answer is shown in the truth&apos;s room frame.</span>
        <span className={TONE.ok}>green: within tolerance</span>
        <span className={TONE.bad}>red: differs</span>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {column(left, "Ground truth")}
        {column(right, `Model (frame ${score.symmetry})`)}
      </div>
    </div>
  );
}
