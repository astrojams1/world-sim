import OpenAI, { toFile } from "openai";
import { NextRequest } from "next/server";
import { buildSystemPrompt, buildUserText, guessSchema, imageIdsForMode, SANDBOX_FILES, SESSION_LOG } from "@/lib/skill";
import { WORLDSIM_PY } from "@/lib/sandbox/worldsim_py";
import { ALLOWED_MODELS, type ModelId } from "@/lib/models";
import { MODES, type Guess, type Mode, type Vec3 } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

interface AnalyzeBody {
  model: ModelId;
  reasoningEffort?: "low" | "medium" | "high";
  /** Which task the images come from (static: two images; platform: four). The mode only selects the prompt and schema. */
  mode?: Mode;
  /** Data URLs of the unaltered feeds. This is the only room data the model ever receives. */
  images: { A: string; B: string; A2?: string; B2?: string };
}

export interface CodeRun {
  code: string | null;
  logs: string;
  status: string;
}

function dataUrlToBuffer(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(",");
  return Buffer.from(dataUrl.slice(comma + 1), "base64");
}

/**
 * POST: upload the feeds + the helper module to the model's sandbox and start a background
 * response. Returns { responseId }. The client then polls GET ?id=... (Vercel functions have
 * short timeouts; the model's sandbox loop can take minutes). Nothing about the room other than
 * the images is sent: no calibration, no colours, no platform pose.
 */
export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ error: "OPENAI_API_KEY is not set on the server." }, { status: 500 });

  let body: AnalyzeBody;
  try {
    body = (await req.json()) as AnalyzeBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!ALLOWED_MODELS.includes(body.model)) {
    return Response.json({ error: `Model must be one of ${ALLOWED_MODELS.join(", ")}` }, { status: 400 });
  }
  const mode: Mode = body.mode ?? "static";
  if (!MODES.includes(mode)) return Response.json({ error: `Mode must be one of ${MODES.join(", ")}` }, { status: 400 });
  const ids = imageIdsForMode(mode);
  if (!ids.every((id) => body.images?.[id]?.startsWith("data:image/jpeg"))) {
    return Response.json({ error: `${ids.length} JPEG camera images are required (${ids.join(", ")}).` }, { status: 400 });
  }

  const client = new OpenAI({ apiKey });
  const isReasoningModel = body.model.startsWith("gpt-5");
  const uploaded: string[] = [];
  try {
    const upload = async (name: string, content: Buffer | string) => {
      const f = await client.files.create({ file: await toFile(Buffer.from(content), name), purpose: "user_data" });
      uploaded.push(f.id);
      return f.id;
    };
    await Promise.all([upload(SANDBOX_FILES.helper, WORLDSIM_PY), ...ids.map((id) => upload(SANDBOX_FILES[id], dataUrlToBuffer(body.images[id]!)))]);

    const response = await client.responses.create({
      model: body.model,
      background: true,
      store: true,
      instructions: buildSystemPrompt(mode),
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: buildUserText(mode) },
            ...ids.map((id) => ({ type: "input_image" as const, image_url: body.images[id]!, detail: "high" as const })),
          ],
        },
      ],
      tools: [{ type: "code_interpreter", container: { type: "auto", file_ids: uploaded } }],
      include: ["code_interpreter_call.outputs"],
      ...(isReasoningModel ? { reasoning: { effort: body.reasoningEffort ?? "medium" } } : { temperature: 0.2 }),
      text: { format: { type: "json_schema", name: "room_reconstruction", schema: guessSchema(mode), strict: true } },
      max_output_tokens: 60000,
      metadata: { files: uploaded.join(",") },
    });
    return Response.json({ responseId: response.id, status: response.status });
  } catch (err: unknown) {
    await Promise.allSettled(uploaded.map((id) => client.files.delete(id)));
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 502 });
  }
}

const num3 = (v: unknown): Vec3 | null =>
  Array.isArray(v) && v.length === 3 ? ([Number(v[0]), Number(v[1]), Number(v[2])] as Vec3) : null;

/** GET ?id=resp_...: poll a background response. */
export async function GET(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ error: "OPENAI_API_KEY is not set on the server." }, { status: 500 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id || !/^resp_[A-Za-z0-9]+$/.test(id)) return Response.json({ error: "Missing or invalid id" }, { status: 400 });

  const client = new OpenAI({ apiKey });
  try {
    const response = await client.responses.retrieve(id, { include: ["code_interpreter_call.outputs"] });
    const codeRuns: CodeRun[] = [];
    let containerId: string | null = null;
    for (const item of response.output ?? []) {
      if (item.type === "code_interpreter_call") {
        containerId = item.container_id ?? containerId;
        // The API does not return code outputs for stored responses; the sandbox writes a transcript instead.
        const logs = (item.outputs ?? []).map((o) => (o.type === "logs" ? o.logs : "[image output]")).join("\n");
        codeRuns.push({ code: item.code, logs, status: item.status });
      }
    }
    if (response.status === "queued" || response.status === "in_progress") {
      return Response.json({ status: response.status, codeRuns });
    }

    // Terminal state: fetch the sandbox transcript, then clean up the uploaded files.
    const sessionLog = containerId ? await fetchSessionLog(client, containerId) : "";
    const files = (response.metadata?.files ?? "").split(",").filter(Boolean);
    await Promise.allSettled(files.map((fid) => client.files.delete(fid)));

    if (response.status !== "completed") {
      return Response.json(
        {
          status: response.status,
          error: response.error?.message ?? response.incomplete_details?.reason ?? `Response ${response.status}`,
          codeRuns,
          sessionLog,
        },
        { status: 502 },
      );
    }
    const text = response.output_text ?? "";
    let parsed: {
      notes?: string;
      platform?: { position?: unknown; normal?: unknown; velocity?: unknown };
      objects?: Array<Guess["objects"][number] & { rotation?: number[] | null }>;
    } | null = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    if (!parsed || !Array.isArray(parsed.objects)) {
      return Response.json({ status: "completed", error: "Model did not return valid JSON.", raw: text, codeRuns, sessionLog }, { status: 502 });
    }
    const guess: Guess = {
      objects: parsed.objects.map((o) => ({
        shape: o.shape,
        color: o.color,
        size: Number(o.size),
        position: [Number(o.position?.[0]), Number(o.position?.[1]), Number(o.position?.[2])],
        ...(o.shape === "cube" && Array.isArray(o.rotation) && o.rotation.length === 3
          ? { rotation: [Number(o.rotation[0]), Number(o.rotation[1]), Number(o.rotation[2])] as [number, number, number] }
          : {}),
      })),
    };
    const p = parsed.platform;
    const position = num3(p?.position), normal = num3(p?.normal), velocity = num3(p?.velocity);
    if (position && normal && velocity) guess.platform = { position, normal, velocity };
    return Response.json({
      status: "completed",
      guess,
      notes: parsed.notes ?? "",
      usage: response.usage,
      model: response.model,
      codeRuns,
      sessionLog,
      usedSandbox: codeRuns.length > 0,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 502 });
  }
}

/** Read /mnt/data/session_log.txt (everything the model printed) from the sandbox container, if it still exists. */
async function fetchSessionLog(client: OpenAI, containerId: string): Promise<string> {
  try {
    const page = await client.containers.files.list(containerId, { limit: 100 });
    let logFile: { id: string } | null = null;
    for await (const f of page) {
      if (f.path.endsWith(SESSION_LOG)) logFile = f;
    }
    if (!logFile) return "";
    const res = await client.containers.files.content.retrieve(logFile.id, { container_id: containerId });
    const text = await res.text();
    return text.length > 200_000 ? text.slice(-200_000) : text;
  } catch {
    return "";
  }
}
