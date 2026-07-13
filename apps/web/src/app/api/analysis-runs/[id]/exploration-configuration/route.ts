import {
  getPool,
  resetAnalysisRunJobToQueued,
  upsertExplorationConfiguration,
} from "@analysis-tool/database";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const VALID_PACKAGE_MANAGERS = new Set(["npm", "yarn", "pnpm", "bun"]);

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!uuidPattern.test(id)) {
    return Response.json({ error: "Analysis run not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;

  const startupPackageManager =
    raw.startupPackageManager === null || raw.startupPackageManager === undefined
      ? null
      : typeof raw.startupPackageManager === "string" &&
          VALID_PACKAGE_MANAGERS.has(raw.startupPackageManager)
        ? raw.startupPackageManager
        : undefined;

  if (startupPackageManager === undefined) {
    return Response.json({ error: "Invalid startupPackageManager" }, { status: 400 });
  }

  const startupScript =
    raw.startupScript === null || raw.startupScript === undefined
      ? null
      : typeof raw.startupScript === "string" &&
          /^[a-zA-Z0-9:_.-]+$/.test(raw.startupScript)
        ? raw.startupScript
        : undefined;

  if (startupScript === undefined) {
    return Response.json({ error: "Invalid startupScript" }, { status: 400 });
  }

  // envVarRefs: only store env var names (no values — security boundary)
  const envVarRefs =
    Array.isArray(raw.envVarRefs) &&
    raw.envVarRefs.every(
      (ref) =>
        typeof ref === "string" &&
        ref.length > 0 &&
        /^[A-Z_][A-Z0-9_]*$/i.test(ref),
    )
      ? (raw.envVarRefs as string[])
      : raw.envVarRefs === undefined
        ? []
        : undefined;

  if (envVarRefs === undefined) {
    return Response.json({ error: "Invalid envVarRefs" }, { status: 400 });
  }

  const pool = getPool();

  try {
    const config = await upsertExplorationConfiguration(pool, id, {
      startupPackageManager,
      startupScript,
      envVarRefs,
    });

    const reset = await resetAnalysisRunJobToQueued(pool, id);

    return Response.json({ config, queued: reset });
  } catch {
    return Response.json(
      { error: "Configuration storage is unavailable" },
      { status: 503 },
    );
  }
}
