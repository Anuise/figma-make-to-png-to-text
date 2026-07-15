import {
  DEFAULT_AI_EXPORT_POLICY,
  enqueueWorkflowDraftJob,
  getAiExportPolicy,
  getPool,
  listConfirmedAndUnlinkedScreenIds,
  listWorkflowDrafts,
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
    const drafts = await listWorkflowDrafts(getPool(), id);
    return Response.json({ drafts });
  } catch {
    return Response.json(
      { error: "Analysis run storage is unavailable" },
      { status: 503 },
    );
  }
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!uuidPattern.test(id)) {
    return Response.json({ error: "Analysis run not found" }, { status: 404 });
  }

  const pool = getPool();

  try {
    const policy = await getAiExportPolicy(pool, id);
    const dataExportAllowed = policy?.dataExportAllowed ?? DEFAULT_AI_EXPORT_POLICY.dataExportAllowed;
    const aiNoticeAcknowledgedAt =
      policy?.aiNoticeAcknowledgedAt ?? DEFAULT_AI_EXPORT_POLICY.aiNoticeAcknowledgedAt;

    const screenIds = await listConfirmedAndUnlinkedScreenIds(pool, id);
    if (screenIds.length === 0) {
      return Response.json(
        { error: "No confirmed screens available to generate workflow drafts from" },
        { status: 400 },
      );
    }

    if (!dataExportAllowed) {
      const job = await enqueueWorkflowDraftJob(pool, id, screenIds, "awaiting-manual");
      return Response.json({ job }, { status: 201 });
    }

    if (!aiNoticeAcknowledgedAt) {
      return Response.json(
        { error: "Acknowledge the Free Tier data usage notice before generating" },
        { status: 409 },
      );
    }

    const job = await enqueueWorkflowDraftJob(pool, id, screenIds, "queued");
    return Response.json({ job }, { status: 201 });
  } catch {
    return Response.json(
      { error: "Analysis run storage is unavailable" },
      { status: 503 },
    );
  }
}
