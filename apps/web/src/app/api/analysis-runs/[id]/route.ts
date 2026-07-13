import { getAnalysisRun, getPool } from "@analysis-tool/database";

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
    const run = await getAnalysisRun(getPool(), id);
    return run
      ? Response.json(run)
      : Response.json({ error: "Analysis run not found" }, { status: 404 });
  } catch {
    return Response.json(
      { error: "Analysis run storage is unavailable" },
      { status: 503 },
    );
  }
}
