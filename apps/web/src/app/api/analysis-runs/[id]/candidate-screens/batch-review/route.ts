import {
  batchUpdateScreenReview,
  getPool,
  type ReviewStatus,
} from "@analysis-tool/database";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const validStatuses: ReviewStatus[] = ["confirmed", "excluded", "pending"];

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!uuidPattern.test(id)) {
    return Response.json({ error: "Analysis run not found" }, { status: 404 });
  }

  let ids: unknown;
  let reviewStatus: unknown;
  try {
    const body: unknown = await request.json();
    if (typeof body === "object" && body !== null) {
      ids = "ids" in body ? body.ids : undefined;
      reviewStatus = "reviewStatus" in body ? body.reviewStatus : undefined;
    }
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!Array.isArray(ids) || !ids.every((x) => typeof x === "string" && uuidPattern.test(x))) {
    return Response.json({ error: "Invalid ids" }, { status: 400 });
  }
  if (typeof reviewStatus !== "string" || !validStatuses.includes(reviewStatus as ReviewStatus)) {
    return Response.json({ error: "Invalid reviewStatus" }, { status: 400 });
  }

  try {
    const screens = await batchUpdateScreenReview(
      getPool(),
      id,
      ids as string[],
      reviewStatus as ReviewStatus,
    );
    return Response.json({ screens });
  } catch {
    return Response.json(
      { error: "Analysis run storage is unavailable" },
      { status: 503 },
    );
  }
}
