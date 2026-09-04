import OpenAI from "openai";
import { NextRequest } from "next/server";
import { buildFollowupUserText, buildRound1UserText, buildSystemPrompt, GUESS_SCHEMA, type PublicRoom } from "@/lib/skill";
import type { Guess } from "@/lib/types";
import { ALLOWED_MODELS, type ModelId } from "@/lib/models";

export const runtime = "nodejs";
export const maxDuration = 60;


interface AnalyzeBody {
  model: ModelId;
  reasoningEffort?: "low" | "medium" | "high";
  room: PublicRoom;
  images: { A: string; B: string }; // data URLs
  round: number;
  previousResponseId?: string;
  previousGuess?: Guess;
  guessImages?: { A: string; B: string };
}

type InputContent =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail: "high" | "low" | "auto" };

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "OPENAI_API_KEY is not set on the server." }, { status: 500 });
  }
  let body: AnalyzeBody;
  try {
    body = (await req.json()) as AnalyzeBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!ALLOWED_MODELS.includes(body.model)) {
    return Response.json({ error: `Model must be one of ${ALLOWED_MODELS.join(", ")}` }, { status: 400 });
  }
  if (!body.images?.A?.startsWith("data:image/") || !body.images?.B?.startsWith("data:image/")) {
    return Response.json({ error: "Two camera images are required." }, { status: 400 });
  }

  const client = new OpenAI({ apiKey });
  const isReasoningModel = body.model.startsWith("gpt-5");

  const content: InputContent[] = [];
  if (body.round <= 1 || !body.previousResponseId) {
    content.push({ type: "input_text", text: buildRound1UserText() });
    content.push({ type: "input_image", image_url: body.images.A, detail: "high" });
    content.push({ type: "input_image", image_url: body.images.B, detail: "high" });
  } else {
    if (!body.previousGuess || !body.guessImages) {
      return Response.json({ error: "Follow-up rounds need previousGuess and guessImages." }, { status: 400 });
    }
    content.push({ type: "input_text", text: buildFollowupUserText(body.room, body.previousGuess) });
    content.push({ type: "input_image", image_url: body.images.A, detail: "high" });
    content.push({ type: "input_image", image_url: body.images.B, detail: "high" });
    content.push({ type: "input_image", image_url: body.guessImages.A, detail: "high" });
    content.push({ type: "input_image", image_url: body.guessImages.B, detail: "high" });
  }

  const started = Date.now();
  try {
    const response = await client.responses.create({
      model: body.model,
      instructions: buildSystemPrompt(body.room),
      input: [{ role: "user", content }],
      previous_response_id: body.previousResponseId,
      ...(isReasoningModel ? { reasoning: { effort: body.reasoningEffort ?? "medium" } } : { temperature: 0.2 }),
      text: {
        format: { type: "json_schema", name: "room_reconstruction", schema: GUESS_SCHEMA, strict: true },
      },
      max_output_tokens: 16000,
    });

    const text = response.output_text ?? "";
    let parsed: { notes?: string; objects?: Guess["objects"] } | null = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    if (!parsed || !Array.isArray(parsed.objects)) {
      return Response.json(
        { error: "Model did not return valid JSON.", raw: text, status: response.status, incomplete: response.incomplete_details },
        { status: 502 },
      );
    }
    const guess: Guess = {
      objects: parsed.objects.map((o) => ({
        shape: o.shape,
        color: o.color,
        size: Number(o.size),
        position: [Number(o.position?.[0]), Number(o.position?.[1]), Number(o.position?.[2])],
      })),
    };
    return Response.json({
      responseId: response.id,
      guess,
      notes: parsed.notes ?? "",
      usage: response.usage,
      durationMs: Date.now() - started,
      model: response.model,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 502 });
  }
}
