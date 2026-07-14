import {
  getCandidateScreen,
  getPool,
  updateCandidateScreenReview,
  type ReviewStatus,
} from "@analysis-tool/database";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const validStatuses: ReviewStatus[] = ["pending", "confirmed", "excluded", "merged"];

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; screenId: string }> },
) {
  const { id, screenId } = await context.params;
  if (!uuidPattern.test(id) || !uuidPattern.test(screenId)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  let reviewStatus: unknown;
  let screenTitle: unknown;
  let screenNotes: unknown;
  let mergedIntoId: unknown;
  try {
    const body: unknown = await request.json();
    if (typeof body === "object" && body !== null) {
      reviewStatus = "reviewStatus" in body ? body.reviewStatus : undefined;
      screenTitle = "screenTitle" in body ? body.screenTitle : undefined;
      screenNotes = "screenNotes" in body ? body.screenNotes : undefined;
      mergedIntoId = "mergedIntoId" in body ? body.mergedIntoId : undefined;
    }
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (typeof reviewStatus !== "string" || !validStatuses.includes(reviewStatus as ReviewStatus)) {
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

  if (screenTitle !== undefined && screenTitle !== null && typeof screenTitle !== "string") {
    return Response.json({ error: "Invalid screenTitle" }, { status: 400 });
  }
  if (screenNotes !== undefined && screenNotes !== null && typeof screenNotes !== "string") {
    return Response.json({ error: "Invalid screenNotes" }, { status: 400 });
  }

  try {
    const existing = await getCandidateScreen(getPool(), screenId);
    if (!existing || existing.analysisRunId !== id) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    const screen = await updateCandidateScreenReview(getPool(), screenId, {
      reviewStatus: reviewStatus as ReviewStatus,
      screenTitle: screenTitle as string | null | undefined,
      screenNotes: screenNotes as string | null | undefined,
      mergedIntoId: reviewStatus === "merged" ? (mergedIntoId as string) : null,
    });
    return screen
      ? Response.json(screen)
      : Response.json({ error: "Not found" }, { status: 404 });
  } catch {
    return Response.json(
      { error: "Analysis run storage is unavailable" },
      { status: 503 },
    );
  }
}
