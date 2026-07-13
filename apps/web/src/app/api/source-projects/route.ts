import { listSourceProjects } from "@analysis-tool/source-projects";

export async function GET() {
  const root = process.env.SOURCE_PROJECTS_ROOT;

  if (!root) {
    return Response.json(
      { error: "Source project root is unavailable" },
      { status: 503 },
    );
  }

  try {
    return Response.json({ projects: await listSourceProjects(root) });
  } catch {
    return Response.json(
      { error: "Source project root is unavailable" },
      { status: 503 },
    );
  }
}
