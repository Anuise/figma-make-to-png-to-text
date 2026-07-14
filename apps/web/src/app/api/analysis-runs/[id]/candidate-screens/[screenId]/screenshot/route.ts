import { getCandidateScreen, getPool } from "@analysis-tool/database";
import { createReadStream, existsSync } from "node:fs";
import { Readable } from "node:stream";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; screenId: string }> },
) {
  const { id, screenId } = await context.params;
  if (!uuidPattern.test(id) || !uuidPattern.test(screenId)) {
    return new Response("Not found", { status: 404 });
  }

  let screen;
  try {
    screen = await getCandidateScreen(getPool(), screenId);
  } catch {
    return new Response("Storage unavailable", { status: 503 });
  }

  if (!screen || screen.analysisRunId !== id) {
    return new Response("Not found", { status: 404 });
  }

  const { screenshotPath } = screen;
  if (!screenshotPath) {
    return new Response("No screenshot available", { status: 404 });
  }

  // 只允許以 .png 結尾的絕對路徑，防止路徑穿越
  if (!screenshotPath.endsWith(".png") || screenshotPath.includes("..")) {
    return new Response("Not found", { status: 404 });
  }

  if (!existsSync(screenshotPath)) {
    return new Response("Screenshot not found on disk", { status: 404 });
  }

  const nodeStream = createReadStream(screenshotPath);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;

  return new Response(webStream, {
    headers: {
      "content-type": "image/png",
      "cache-control": "private, max-age=3600",
    },
  });
}
