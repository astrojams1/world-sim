import OpenAI, { toFile } from "openai";
import { NextRequest } from "next/server";
import { buildSystemPrompt, buildUserText, GUESS_SCHEMA, SANDBOX_FILES, SESSION_LOG, sceneFile, type PublicRoom } from "@/lib/skill";
import { WORLDSIM_PY } from "@/lib/sandbox/worldsim_py";
import { ALLOWED_MODELS, type ModelId } from "@/lib/models";
import type { Guess } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

interface AnalyzeBody {
  model: ModelId;
  reasoningEffort?: "low" | "medium" | "high";
  room: PublicRoom;
  images: { A: string; B: string }; // data URLs of the unaltered feeds
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
 * POST: upload the feeds + helper module to the model's sandbox and start a background
 * response. Returns { responseId }. The client then polls GET ?id=... (Vercel functions
 * have short timeouts; the model's sandbox loop can take minutes).
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
  if (!body.images?.A?.startsWith("data:image/jpeg") || !body.images?.B?.startsWith("data:image/jpeg")) {
    return Response.json({ error: "Two JPEG camera images are required." }, { status: 400 });
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
    await Promise.all([
      upload(SANDBOX_FILES.helper, WORLDSIM_PY),
      upload(SANDBOX_FILES.scene, JSON.stringify(sceneFile(body.room), null, 2)),
      upload(SANDBOX_FILES.A, dataUrlToBuffer(body.images.A)),
      upload(SANDBOX_FILES.B, dataUrlToBuffer(body.images.B)),
    ]);

    const response = await client.responses.create({
      model: body.model,
      background: true,
      store: true,
      instructions: buildSystemPrompt(body.room),
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: buildUserText() },
            { type: "input_image", image_url: body.images.A, detail: "high" },
            { type: "input_image", image_url: body.images.B, detail: "high" },
          ],
        },
      ],
      tools: [{ type: "code_interpreter", container: { type: "auto", file_ids: uploaded } }],
      include: ["code_interpreter_call.outputs"],
      ...(isReasoningModel ? { reasoning: { effort: body.reasoningEffort ?? "medium" } } : { temperature: 0.2 }),
      text: { format: { type: "json_schema", name: "room_reconstruction", schema: GUESS_SCHEMA, strict: true } },
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
    let parsed: { notes?: string; objects?: Guess["objects"] } | null = null;
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
      })),
    };
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
