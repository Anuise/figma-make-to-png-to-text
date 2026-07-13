# Persistent Local Analysis Run Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Issue #2's Docker Compose skeleton so one local user can choose a source project from a read-only parent directory, create a persisted Analysis Run with an immutable Source Revision and isolated Working Copy, and inspect it after services restart.

**Architecture:** An npm-workspaces monorepo contains a Next.js control plane, a PostgreSQL-backed TypeScript worker, and two shared packages for database access and safe source-project filesystem operations. PostgreSQL 16 stores runs, revisions, and the single-worker queue; Docker named volumes store database data, immutable snapshots, and writable working copies.

**Tech Stack:** Node.js 22, npm 10, Next.js 16.2.10, React 19.2.7, TypeScript 5.9.3, `pg` 8.22.0, `tsx` 4.23.1, Vitest 4.1.10, PostgreSQL 16, Docker Compose v2.

## Global Constraints

- Support target: Windows 11, Docker Desktop WSL2 backend, and Docker Compose v2.
- Issue #2 includes only `web`, TypeScript `worker`, and PostgreSQL 16; do not add `ai-worker`, ClickHouse, or MinIO.
- Mount the configured source-project parent at `/sources` read-only; persist only direct-child relative paths.
- Reject absolute paths, nested paths, `..`, files, and symlinks that escape the configured source parent.
- Perform every dependency install and temporary modification outside `/sources`; this issue creates but does not execute the Working Copy.
- Use PostgreSQL as the only source of truth for Analysis Runs, Source Revisions, and queued jobs; do not add an ORM or external queue.
- Save source snapshots and working copies in Docker named volumes; never overwrite a completed Source Revision.
- Follow vertical-slice TDD: write one public-seam test, observe the expected failure, implement only enough to pass, and rerun the focused tests.
- Test through HTTP, process, PostgreSQL, filesystem, and Compose seams; do not test private worker functions or React component internals.
- UI subject: a Windows-first engineering workbench whose single job is selecting a Source Project and reading the preparation ledger.
- UI palette: `Ink #14242E`, `Draft #EDF1EE`, `Cyanotype #2D9FA8`, `Amber #E6A23C`, `Paper #FAFBF7`; typography uses `Bahnschrift`, `Segoe UI`, and `Consolas` fallbacks without external font downloads.
- UI signature: each Analysis Run is a ledger row with a visible status rail and monospace fingerprint specimen; keep surrounding decoration restrained.

---

### Task 1: Workspace and Compose Contract

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.dockerignore`
- Create: `tsconfig.base.json`
- Create: `compose.yaml`
- Create: `apps/web/Dockerfile`
- Create: `apps/worker/Dockerfile`
- Create: `tests/compose-contract.test.mjs`
- Create: `tests/fixtures/sources/project-alpha/package.json`
- Create: `tests/fixtures/sources/project-alpha/src/index.ts`
- Generate: `package-lock.json`

**Interfaces:**
- Produces: Compose services named `web`, `worker`, and `postgres`.
- Produces: read-only `/sources` mounts for `web` and `worker`.
- Produces: named volumes mounted at `/var/lib/postgresql/data` and `/data`.
- Produces: root scripts `test`, `typecheck`, `build`, `db:migrate`, `worker:once`.

- [ ] **Step 1: Add the test harness and failing Compose contract test**

Create a private npm-workspaces root package with `tsx` 4.23.1, TypeScript 5.9.3, Vitest 4.1.10, and `@types/node` 22.20.1 dev dependencies. Add this test before `compose.yaml` exists:

```js
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

test("Compose declares the persistent local analysis services", () => {
  const output = execFileSync(
    "docker",
    ["compose", "config", "--format", "json"],
    { encoding: "utf8" },
  );
  const config = JSON.parse(output);

  assert.deepEqual(Object.keys(config.services).sort(), [
    "postgres",
    "web",
    "worker",
  ]);
  assert.match(config.services.postgres.image, /^postgres:16/);

  for (const serviceName of ["web", "worker"]) {
    const sourceMount = config.services[serviceName].volumes.find(
      (volume) => volume.target === "/sources",
    );
    assert.equal(sourceMount.type, "bind");
    assert.equal(sourceMount.read_only, true);
  }

  assert.ok(
    config.services.postgres.volumes.some(
      (volume) => volume.target === "/var/lib/postgresql/data",
    ),
  );
  assert.ok(
    config.services.worker.volumes.some(
      (volume) => volume.target === "/data",
    ),
  );
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- tests/compose-contract.test.mjs`

Expected: FAIL because `compose.yaml` is absent and Docker Compose reports that no configuration file was provided.

- [ ] **Step 3: Add the minimal workspace and Compose configuration**

Define:

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: analysis_tool
      POSTGRES_USER: analysis_tool
      POSTGRES_PASSWORD: analysis_tool
    ports:
      - "${POSTGRES_PORT:-54329}:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U analysis_tool -d analysis_tool"]
      interval: 2s
      timeout: 3s
      retries: 30
    volumes:
      - postgres-data:/var/lib/postgresql/data
  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    environment:
      DATABASE_URL: postgresql://analysis_tool:analysis_tool@postgres:5432/analysis_tool
      SOURCE_PROJECTS_ROOT: /sources
    ports:
      - "${WEB_PORT:-3000}:3000"
    depends_on:
      postgres:
        condition: service_healthy
    volumes:
      - type: bind
        source: ${SOURCE_PROJECTS_ROOT:-./tests/fixtures/sources}
        target: /sources
        read_only: true
  worker:
    build:
      context: .
      dockerfile: apps/worker/Dockerfile
    environment:
      DATABASE_URL: postgresql://analysis_tool:analysis_tool@postgres:5432/analysis_tool
      SOURCE_PROJECTS_ROOT: /sources
      ANALYSIS_DATA_ROOT: /data
    depends_on:
      postgres:
        condition: service_healthy
    volumes:
      - type: bind
        source: ${SOURCE_PROJECTS_ROOT:-./tests/fixtures/sources}
        target: /sources
        read_only: true
      - analysis-data:/data
volumes:
  postgres-data:
  analysis-data:
```

The initial Dockerfiles may install the workspace and invoke scripts that later tasks provide; Compose configuration must resolve before the images build.

- [ ] **Step 4: Generate the lockfile and verify GREEN**

Run: `npm install`

Run: `npm test -- tests/compose-contract.test.mjs`

Expected: PASS, 1 test and 0 failures.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .gitignore .dockerignore tsconfig.base.json compose.yaml apps tests
git commit -m "build: scaffold compose workspace"
```

### Task 2: Safe Source Project HTTP API

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/next.config.ts`
- Create: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/app/api/health/route.ts`
- Create: `apps/web/src/app/api/source-projects/route.ts`
- Create: `packages/source-projects/package.json`
- Create: `packages/source-projects/tsconfig.json`
- Create: `packages/source-projects/src/index.ts`
- Create: `packages/source-projects/src/projects.ts`
- Create: `tests/helpers/web-server.mjs`
- Create: `tests/source-projects-api.test.mjs`

**Interfaces:**
- Produces: `GET /api/health -> { status: "ok" }` before database wiring.
- Produces: `GET /api/source-projects -> { projects: SourceProject[] }`.
- Produces: `SourceProject = { name: string; relativePath: string }`.
- Produces: `listSourceProjects(root: string): Promise<SourceProject[]>`.
- Produces: `resolveSourceProject(root: string, relativePath: string): Promise<string>` for reuse by web and worker.

- [ ] **Step 1: Scaffold a bootable empty Next.js app**

Add only the root layout, a page that renders `Analysis Tool`, and the health route. Add `next@16.2.10`, `react@19.2.7`, and `react-dom@19.2.7` to the web workspace. Do not create the source-project package or route before the RED test.

- [ ] **Step 2: Write the failing source-list API test**

The helper starts `next dev` on an unused localhost port, passes a temporary `SOURCE_PROJECTS_ROOT`, waits for `/api/health`, and always stops the child process. The test creates two directories plus one regular file and asserts the exact sorted response:

```js
test("lists only direct child source-project directories", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "analysis-sources-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "zeta-project"));
  await mkdir(join(root, "alpha-project"));
  await writeFile(join(root, "notes.txt"), "not a project");

  const server = await startWebServer({ SOURCE_PROJECTS_ROOT: root });
  context.after(() => server.stop());

  const response = await fetch(`${server.url}/api/source-projects`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    projects: [
      { name: "alpha-project", relativePath: "alpha-project" },
      { name: "zeta-project", relativePath: "zeta-project" },
    ],
  });
});
```

- [ ] **Step 3: Run the focused test and verify RED**

Run: `npm test -- tests/source-projects-api.test.mjs`

Expected: FAIL with `404` for `/api/source-projects`.

- [ ] **Step 4: Implement safe direct-child discovery**

`listSourceProjects` resolves the root with `realpath`, reads `Dirent` entries, considers only directories, resolves each candidate with `realpath`, and includes it only when `dirname(candidateRealPath) === rootRealPath`. Sort by `relativePath` with `localeCompare`.

`resolveSourceProject` rejects when the input is empty, absolute, contains `/` or `\\`, equals `.` or `..`, is not a directory, is a symlink, or resolves outside the direct parent. Return the canonical candidate path.

The route maps a missing/unreadable root to status `503` with `{ error: "Source project root is unavailable" }` and successful results to status `200`.

- [ ] **Step 5: Verify GREEN and typecheck**

Run: `npm test -- tests/source-projects-api.test.mjs`

Expected: PASS.

Run: `npm run typecheck`

Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web packages/source-projects tests package.json package-lock.json
git commit -m "feat: list safe source projects"
```

### Task 3: Persisted Analysis Run HTTP API

**Files:**
- Create: `packages/database/package.json`
- Create: `packages/database/tsconfig.json`
- Create: `packages/database/migrations/001_initial.sql`
- Create: `packages/database/src/client.ts`
- Create: `packages/database/src/migrate.ts`
- Create: `packages/database/src/analysis-runs.ts`
- Create: `packages/database/src/jobs.ts`
- Create: `packages/database/src/index.ts`
- Modify: `apps/web/src/app/api/health/route.ts`
- Create: `apps/web/src/app/api/analysis-runs/route.ts`
- Create: `apps/web/src/app/api/analysis-runs/[id]/route.ts`
- Create: `tests/helpers/postgres.mjs`
- Create: `tests/analysis-runs-api.test.mjs`

**Interfaces:**
- Produces: `POST /api/analysis-runs` with `{ sourceProject: string }`.
- Produces: `GET /api/analysis-runs` and `GET /api/analysis-runs/:id`.
- Produces: `AnalysisRun.status = "queued" | "preparing" | "ready" | "failed"`.
- Produces: transactional `createAnalysisRun(pool, sourceRelativePath)` that also inserts one queued job.
- Produces: idempotent `migrate(pool)` and CLI `npm run db:migrate`.

- [ ] **Step 1: Add the database workspace and migration runner shell**

Add `pg@8.22.0` and `@types/pg@8.20.0`. The migration runner may connect and create `schema_migrations`, but `001_initial.sql` must not yet create the three domain tables.

- [ ] **Step 2: Write the failing HTTP persistence test**

Start only the Compose `postgres` service on `POSTGRES_PORT=54329`, migrate a clean test database, create a temporary source root with `project-alpha`, and start the web process with its database URL. Assert:

```js
const createdResponse = await fetch(`${server.url}/api/analysis-runs`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ sourceProject: "project-alpha" }),
});
assert.equal(createdResponse.status, 201);
const created = await createdResponse.json();
assert.equal(created.sourceRelativePath, "project-alpha");
assert.equal(created.status, "queued");
assert.equal(created.sourceRevision, null);

const listedResponse = await fetch(`${server.url}/api/analysis-runs`);
assert.equal(listedResponse.status, 200);
assert.deepEqual((await listedResponse.json()).runs.map((run) => run.id), [
  created.id,
]);

const invalidResponse = await fetch(`${server.url}/api/analysis-runs`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ sourceProject: "../outside" }),
});
assert.equal(invalidResponse.status, 400);
```

- [ ] **Step 3: Run the focused test and verify RED**

Run: `npm test -- tests/analysis-runs-api.test.mjs`

Expected: FAIL because `analysis_runs`, `source_revisions`, and `jobs` do not exist or the route returns `404`.

- [ ] **Step 4: Implement the schema and transactional API**

Migration `001_initial.sql` creates enum-like `CHECK` constraints and these columns:

```sql
CREATE TABLE analysis_runs (
  id uuid PRIMARY KEY,
  source_relative_path text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'preparing', 'ready', 'failed')),
  source_revision_id uuid,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE source_revisions (
  id uuid PRIMARY KEY,
  analysis_run_id uuid NOT NULL UNIQUE REFERENCES analysis_runs(id) ON DELETE CASCADE,
  fingerprint char(64) NOT NULL,
  snapshot_path text NOT NULL UNIQUE,
  working_copy_path text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE analysis_runs
  ADD CONSTRAINT analysis_runs_source_revision_fk
  FOREIGN KEY (source_revision_id) REFERENCES source_revisions(id);

CREATE TABLE jobs (
  id uuid PRIMARY KEY,
  analysis_run_id uuid NOT NULL UNIQUE REFERENCES analysis_runs(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  locked_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

Use `crypto.randomUUID()` for IDs. `createAnalysisRun` inserts the run and job in one transaction and rolls back both on failure. Query functions join the optional revision and map database snake_case to JSON camelCase. Routes return `400` for invalid JSON/path, `404` for an unknown UUID, and `503` when PostgreSQL is unavailable.

- [ ] **Step 5: Verify GREEN, focused suite, and typecheck**

Run: `npm test -- tests/analysis-runs-api.test.mjs`

Expected: PASS.

Run: `npm test -- tests/source-projects-api.test.mjs tests/analysis-runs-api.test.mjs`

Expected: PASS.

Run: `npm run typecheck`

Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add packages/database apps/web tests package.json package-lock.json
git commit -m "feat: persist queued analysis runs"
```

### Task 4: Worker Creates Immutable Source Revisions

**Files:**
- Create: `apps/worker/package.json`
- Create: `apps/worker/tsconfig.json`
- Create: `apps/worker/src/main.ts`
- Create: `apps/worker/src/process-next-job.ts`
- Create: `packages/source-projects/src/fingerprint.ts`
- Create: `packages/source-projects/src/copy.ts`
- Modify: `packages/source-projects/src/index.ts`
- Modify: `packages/database/src/jobs.ts`
- Create: `tests/worker-source-revision.test.mjs`

**Interfaces:**
- Produces: `npm run worker:once` that exits 0 after processing zero or one job.
- Produces: long-running worker command that polls every 1 second.
- Produces: SHA-256 fingerprint algorithm over sorted `directory\\0<relative-path>\\0` and `file\\0<relative-path>\\0<bytes>\\0` records using `/` separators.
- Produces: immutable `/data/source-revisions/<analysis-run-id>` and writable `/data/working-copies/<analysis-run-id>`.
- Produces: atomic `claimNextJob`, `completeJob`, and `failJob` database operations.

- [ ] **Step 1: Add a bootable worker shell**

The worker CLI accepts `--once`. Initially it connects, runs migrations, and exits without claiming work so the process seam exists before the behavior test.

- [ ] **Step 2: Write the failing worker integration test**

Use the real HTTP API to create a run from this exact fixture:

```text
package.json          {"name":"fixture"}\n
src/index.ts          export const value = 1;\n
```

Run the worker once with temporary `SOURCE_PROJECTS_ROOT` and `ANALYSIS_DATA_ROOT`. Fetch the run and assert:

```js
assert.equal(run.status, "ready");
assert.equal(
  run.sourceRevision.fingerprint,
  "f4f6dc32d7c67eb14d53774d2b653596f0a80236d670c82875e4ef52e259fdf8",
);
assert.equal(
  await readFile(join(run.sourceRevision.snapshotPath, "src/index.ts"), "utf8"),
  "export const value = 1;\n",
);
assert.equal(
  await readFile(join(run.sourceRevision.workingCopyPath, "src/index.ts"), "utf8"),
  "export const value = 1;\n",
);

await writeFile(
  join(run.sourceRevision.workingCopyPath, "src/index.ts"),
  "changed in working copy\n",
);
assert.equal(
  await readFile(join(sourceRoot, "project-alpha/src/index.ts"), "utf8"),
  "export const value = 1;\n",
);
assert.equal(
  await readFile(join(run.sourceRevision.snapshotPath, "src/index.ts"), "utf8"),
  "export const value = 1;\n",
);
```

- [ ] **Step 3: Run the focused test and verify RED**

Run: `npm test -- tests/worker-source-revision.test.mjs`

Expected: FAIL because the run remains `queued` and has no Source Revision.

- [ ] **Step 4: Implement deterministic fingerprinting and safe copying**

Walk entries in lexical relative-path order, reject every symlink, normalize separators to `/`, and hash the record format specified above. Copy source to a unique temporary sibling directory, fingerprint source and temporary snapshot independently, and fail if the values differ. Atomically rename the verified snapshot, recursively remove write bits from snapshot files/directories, then copy it to the run-specific Working Copy with write permission.

On retry, remove abandoned temporary directories. If a final run-specific snapshot exists without a committed revision, verify its fingerprint and reuse it; never overwrite a committed Source Revision.

- [ ] **Step 5: Implement PostgreSQL job claiming and completion**

Claim with one transaction and `FOR UPDATE SKIP LOCKED`. Eligible jobs are `queued` or `processing` with `locked_at` older than 30 seconds. Increment attempts, set `processing`, and mark the run `preparing` atomically.

After filesystem work, one transaction inserts `source_revisions`, sets `analysis_runs.source_revision_id`, changes the run to `ready`, and completes the job. On failure, clean temporary paths and transactionally mark run/job `failed` with a concise message.

- [ ] **Step 6: Verify GREEN and regression tests**

Run: `npm test -- tests/worker-source-revision.test.mjs`

Expected: PASS.

Run: `npm test -- tests/source-projects-api.test.mjs tests/analysis-runs-api.test.mjs tests/worker-source-revision.test.mjs`

Expected: PASS.

Run: `npm run typecheck`

Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add apps/worker packages/source-projects packages/database tests package.json package-lock.json
git commit -m "feat: prepare immutable source revisions"
```

### Task 5: Analysis Workbench Control Plane

**Files:**
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/app/analysis-workbench.tsx`
- Create: `apps/web/src/app/globals.css`
- Create: `tests/control-plane-page.test.mjs`

**Interfaces:**
- Produces: page title `Source preparation ledger`.
- Produces: source-project selector, `Create analysis run` action, and live run ledger.
- Produces: status labels `Queued`, `Preparing`, `Ready`, and `Failed`.
- Polls `GET /api/analysis-runs` every 2 seconds while any run is not terminal.
- Preserves visible keyboard focus and respects `prefers-reduced-motion`.

- [ ] **Step 1: Write the failing public-page test**

Start the web server with a temporary source root and database, fetch `/`, and assert the server-rendered HTML contains the stable user-facing anchors:

```js
assert.match(html, /Source preparation ledger/);
assert.match(html, /Choose a source project/);
assert.match(html, /Create analysis run/);
assert.match(html, /No analysis runs yet/);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- tests/control-plane-page.test.mjs`

Expected: FAIL because the placeholder page contains only `Analysis Tool`.

- [ ] **Step 3: Implement the workbench UI**

Use a responsive two-column desktop layout that collapses to one column below 800px:

```text
┌──────────────────────────────────────────────────────────────┐
│ FIGMA MAKE ANALYSIS                     SYSTEM / LOCAL READY │
│ Source preparation ledger                                  │
├──────────────────────┬───────────────────────────────────────┤
│ Choose source        │ Analysis runs                         │
│ [project-alpha   ▾]  │ ┃ READY  project-alpha               │
│ [Create analysis run]│ ┃ f4f6dc32…  revision / timestamp     │
└──────────────────────┴───────────────────────────────────────┘
```

Use Ink for text and rails, Paper/Draft surfaces, Cyanotype for ready/selection, and Amber for queued/preparing. Use square-to-soft `6px` radii rather than generic pill-heavy cards. The status rail is the single signature element. Render actionable error copy for unavailable sources and failed creation. Disable the button while submitting or when no source is available.

- [ ] **Step 4: Verify GREEN, build, and typecheck**

Run: `npm test -- tests/control-plane-page.test.mjs`

Expected: PASS.

Run: `npm run typecheck`

Expected: exits 0.

Run: `npm run build`

Expected: exits 0 with successful web and worker builds.

- [ ] **Step 5: Commit**

```bash
git add apps/web tests/control-plane-page.test.mjs
git commit -m "feat: add source preparation workbench"
```

### Task 6: Compose Restart Acceptance and Operator Docs

**Files:**
- Modify: `apps/web/Dockerfile`
- Modify: `apps/worker/Dockerfile`
- Modify: `compose.yaml`
- Create: `.env.example`
- Create: `README.md`
- Create: `tests/compose-persistence.test.mjs`

**Interfaces:**
- Produces: healthy `web`, continuously polling `worker`, and PostgreSQL 16 containers.
- Produces: documented `SOURCE_PROJECTS_ROOT`, `WEB_PORT`, and `POSTGRES_PORT` configuration.
- Produces: repeatable `docker compose up --build` and `docker compose down` workflow.
- Verifies: an Analysis Run and its Source Revision remain queryable after `docker compose down` followed by `docker compose up -d` without `-v`.

- [ ] **Step 1: Write the Compose persistence acceptance test**

Use a unique `COMPOSE_PROJECT_NAME`, random host ports, and the tracked source fixture. The test must:

1. Run `docker compose up --build -d`.
2. Wait for `GET /api/health` and assert all three containers are running.
3. Create an Analysis Run via HTTP and wait until status is `ready`.
4. Save its ID, fingerprint, snapshot path, and working-copy path.
5. Run `docker compose down` without `-v`.
6. Run `docker compose up -d` with the same project name.
7. Fetch the saved ID and assert all saved values and `ready` status are unchanged.
8. In cleanup only, run `docker compose down -v --remove-orphans`.

- [ ] **Step 2: Run the acceptance test and verify RED**

Run: `npm test -- tests/compose-persistence.test.mjs`

Expected: FAIL at image build, healthcheck, worker polling, or migration startup until the production Dockerfiles and commands are complete.

- [ ] **Step 3: Complete production containers and healthchecks**

Both Dockerfiles use `node:22-bookworm-slim`, copy the root lockfile and workspaces, run `npm ci`, and build only the required workspace dependency graph. The web container runs migrations before `next start -H 0.0.0.0`; the worker runs migrations before entering its polling loop. Add a web healthcheck that fetches `/api/health` and a worker healthcheck based on its process plus successful database connectivity.

Do not mount the repository into running containers. Keep `/sources` read-only and `/data` writable only for worker.

- [ ] **Step 4: Document exact operator workflow**

`README.md` must include:

```powershell
Copy-Item .env.example .env
# Edit SOURCE_PROJECTS_ROOT to an absolute Windows parent directory.
docker compose up --build
docker compose down
```

Explain that `docker compose down` preserves named volumes, while `docker compose down -v` irreversibly deletes local Analysis Runs and Source Revisions. Document the control plane URL and the read-only/direct-child rule.

- [ ] **Step 5: Verify GREEN and full suite**

Run: `npm test -- tests/compose-persistence.test.mjs`

Expected: PASS.

Run: `npm test`

Expected: all tests PASS with 0 failures.

Run: `npm run typecheck`

Expected: exits 0.

Run: `npm run build`

Expected: exits 0.

Run: `docker compose config --quiet`

Expected: exits 0.

- [ ] **Step 6: Visually verify the control plane**

Start the Compose stack, open `http://localhost:3000`, and verify at desktop and narrow viewport widths:

- source selection and create action are visible and keyboard reachable;
- a newly created run visibly progresses to `Ready`;
- fingerprint and revision details remain readable without horizontal overflow;
- focus indicators are visible;
- reduced-motion mode does not depend on animation to convey state.

- [ ] **Step 7: Commit**

```bash
git add apps compose.yaml .env.example README.md tests package.json package-lock.json
git commit -m "test: verify compose restart persistence"
```

## Completion Review

- Run a requirement-by-requirement audit against Issue #2 and the approved design.
- Run the repository `code-review` skill from fixed point `4322302` with Issue #2 as the spec source.
- Resolve all Critical and Important findings, rerun covering tests, and repeat review.
- Run the full verification commands again immediately before the final completion claim.
