import {
  getPool,
  getWorkflowDraft,
  updateWorkflowDraftReview,
  type WorkflowDraftReviewStatus,
} from "@analysis-tool/database";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const validStatuses: WorkflowDraftReviewStatus[] = [
  "pending",
  "confirmed",
  "excluded",
  "merged",
];

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; draftId: string }> },
) {
  const { id, draftId } = await context.params;
  if (!uuidPattern.test(id) || !uuidPattern.test(draftId)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  let reviewStatus: unknown;
  let draftTitle: unknown;
  let draftNotes: unknown;
  let mergedIntoId: unknown;
  try {
    const body: unknown = await request.json();
    if (typeof body === "object" && body !== null) {
      reviewStatus = "reviewStatus" in body ? body.reviewStatus : undefined;
      draftTitle = "draftTitle" in body ? body.draftTitle : undefined;
      draftNotes = "draftNotes" in body ? body.draftNotes : undefined;
      mergedIntoId = "mergedIntoId" in body ? body.mergedIntoId : undefined;
    }
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (
    typeof reviewStatus !== "string" ||
    !validStatuses.includes(reviewStatus as WorkflowDraftReviewStatus)
  ) {
    return Response.json({ error: "Invalid reviewStatus" }, { status: 400 });
  }

  if (reviewStatus === "merged") {
    if (typeof mergedIntoId !== "string" || !uuidPattern.test(mergedIntoId)) {
      return Response.json(
        { error: "mergedIntoId is required when reviewStatus is merged" },
        { status: 400 },
      );
    }
  }

  if (draftTitle !== undefined && draftTitle !== null && typeof draftTitle !== "string") {
    return Response.json({ error: "Invalid draftTitle" }, { status: 400 });
  }
  if (draftNotes !== undefined && draftNotes !== null && typeof draftNotes !== "string") {
    return Response.json({ error: "Invalid draftNotes" }, { status: 400 });
  }

  try {
    const existing = await getWorkflowDraft(getPool(), draftId);
    if (!existing || existing.analysisRunId !== id) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    const draft = await updateWorkflowDraftReview(getPool(), draftId, {
      reviewStatus: reviewStatus as WorkflowDraftReviewStatus,
      draftTitle: draftTitle as string | null | undefined,
      draftNotes: draftNotes as string | null | undefined,
      mergedIntoId: reviewStatus === "merged" ? (mergedIntoId as string) : null,
    });
    return draft
      ? Response.json(draft)
      : Response.json({ error: "Not found" }, { status: 404 });
  } catch {
    return Response.json(
      { error: "Analysis run storage is unavailable" },
      { status: 503 },
    );
  }
}
