import {
  createAnalysisRun,
  getPool,
  listAnalysisRuns,
} from "@analysis-tool/database";
import { resolveSourceProject } from "@analysis-tool/source-projects";

export async function GET() {
  try {
    return Response.json({ runs: await listAnalysisRuns(getPool()) });
  } catch {
    return Response.json(
      { error: "Analysis run storage is unavailable" },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  const root = process.env.SOURCE_PROJECTS_ROOT;
  if (!root) {
    return Response.json(
      { error: "Source project root is unavailable" },
      { status: 503 },
    );
  }

  let sourceProject: unknown;
  try {
    const body: unknown = await request.json();
    sourceProject =
      typeof body === "object" && body !== null && "sourceProject" in body
        ? body.sourceProject
        : undefined;
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (typeof sourceProject !== "string") {
    return Response.json({ error: "Invalid source project" }, { status: 400 });
  }

  try {
    await resolveSourceProject(root, sourceProject);
  } catch {
    return Response.json({ error: "Invalid source project" }, { status: 400 });
  }

  try {
    const run = await createAnalysisRun(getPool(), sourceProject);
    return Response.json(run, { status: 201 });
  } catch {
    return Response.json(
      { error: "Analysis run storage is unavailable" },
      { status: 503 },
    );
  }
}
