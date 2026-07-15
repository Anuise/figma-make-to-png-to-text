import {
  DEFAULT_AI_EXPORT_POLICY,
  getAiExportPolicy,
  getPool,
  upsertAiExportPolicy,
} from "@analysis-tool/database";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!uuidPattern.test(id)) {
    return Response.json({ error: "Analysis run not found" }, { status: 404 });
  }

  try {
    const policy = await getAiExportPolicy(getPool(), id);
    return Response.json({ policy: policy ?? { analysisRunId: id, ...DEFAULT_AI_EXPORT_POLICY } });
  } catch {
    return Response.json(
      { error: "Analysis run storage is unavailable" },
      { status: 503 },
    );
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!uuidPattern.test(id)) {
    return Response.json({ error: "Analysis run not found" }, { status: 404 });
  }

  let dataExportAllowed: unknown;
  let acknowledgeNotice: unknown;
  try {
    const body: unknown = await request.json();
    if (typeof body === "object" && body !== null) {
      dataExportAllowed =
        "dataExportAllowed" in body ? body.dataExportAllowed : undefined;
      acknowledgeNotice =
        "acknowledgeNotice" in body ? body.acknowledgeNotice : undefined;
    }
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (dataExportAllowed !== undefined && typeof dataExportAllowed !== "boolean") {
    return Response.json({ error: "Invalid dataExportAllowed" }, { status: 400 });
  }
  if (acknowledgeNotice !== undefined && typeof acknowledgeNotice !== "boolean") {
    return Response.json({ error: "Invalid acknowledgeNotice" }, { status: 400 });
  }

  try {
    const policy = await upsertAiExportPolicy(getPool(), id, {
      dataExportAllowed: dataExportAllowed as boolean | undefined,
      acknowledgeNotice: acknowledgeNotice as boolean | undefined,
    });
    return Response.json({ policy });
  } catch {
    return Response.json(
      { error: "Analysis run storage is unavailable" },
      { status: 503 },
    );
  }
}
