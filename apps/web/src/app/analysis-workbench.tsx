"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type SourceProject = {
  name: string;
  relativePath: string;
};

type SourceRevision = {
  id: string;
  fingerprint: string;
  snapshotPath: string;
  workingCopyPath: string;
  createdAt: string;
};

type AnalysisRun = {
  id: string;
  sourceRelativePath: string;
  status: "queued" | "preparing" | "ready" | "failed" | "awaiting-config";
  errorMessage: string | null;
  startupContractReason: string | null;
  sourceRevision: SourceRevision | null;
  createdAt: string;
  updatedAt: string;
};

const statusLabels: Record<AnalysisRun["status"], string> = {
  queued: "Queued",
  preparing: "Preparing",
  ready: "Ready",
  failed: "Failed",
  "awaiting-config": "Needs config",
};

async function responseError(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string"
    ) {
      return body.error;
    }
  } catch {}
  return fallback;
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function AnalysisWorkbench() {
  const [projects, setProjects] = useState<SourceProject[]>([]);
  const [selectedProject, setSelectedProject] = useState("");
  const [runs, setRuns] = useState<AnalysisRun[]>([]);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [loadingSources, setLoadingSources] = useState(true);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [overridingRunId, setOverridingRunId] = useState<string | null>(null);
  const [overridePm, setOverridePm] = useState("");
  const [overrideScript, setOverrideScript] = useState("");
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [overrideSubmitting, setOverrideSubmitting] = useState(false);
  const latestRunsRequest = useRef(0);

  const loadProjects = useCallback(async () => {
    try {
      const response = await fetch("/api/source-projects", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(
          await responseError(response, "Source projects could not be loaded"),
        );
      }
      const body: { projects: SourceProject[] } = await response.json();
      setProjects(body.projects);
      setSelectedProject((current) => current || body.projects[0]?.relativePath || "");
      setSourceError(null);
    } catch (error) {
      setSourceError(
        error instanceof Error
          ? error.message
          : "Source projects could not be loaded",
      );
    } finally {
      setLoadingSources(false);
    }
  }, []);

  const loadRuns = useCallback(async () => {
    const request = ++latestRunsRequest.current;
    try {
      const response = await fetch("/api/analysis-runs", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(
          await responseError(response, "Analysis runs could not be loaded"),
        );
      }
      const body: { runs: AnalysisRun[] } = await response.json();
      if (request === latestRunsRequest.current) {
        setRuns(body.runs);
        setListError(null);
      }
    } catch (error) {
      if (request === latestRunsRequest.current) {
        setListError(
          error instanceof Error
            ? error.message
            : "Analysis runs could not be loaded",
        );
      }
    } finally {
      if (request === latestRunsRequest.current) {
        setLoadingRuns(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadProjects();
    void loadRuns();
  }, [loadProjects, loadRuns]);

  const hasActiveRun = useMemo(
    () => runs.some((run) => run.status === "queued" || run.status === "preparing"),
    [runs],
  );

  useEffect(() => {
    if (!hasActiveRun) {
      return;
    }
    const interval = window.setInterval(() => void loadRuns(), 2_000);
    return () => window.clearInterval(interval);
  }, [hasActiveRun, loadRuns]);

  async function submitOverride(runId: string) {
    if (overrideSubmitting) return;
    setOverrideSubmitting(true);
    setOverrideError(null);
    try {
      const response = await fetch(
        `/api/analysis-runs/${runId}/exploration-configuration`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            startupPackageManager: overridePm || null,
            startupScript: overrideScript || null,
            envVarRefs: [],
          }),
        },
      );
      if (!response.ok) {
        throw new Error(
          await responseError(response, "Configuration could not be saved"),
        );
      }
      setOverridingRunId(null);
      setOverridePm("");
      setOverrideScript("");
      await loadRuns();
    } catch (error) {
      setOverrideError(
        error instanceof Error ? error.message : "Configuration could not be saved",
      );
    } finally {
      setOverrideSubmitting(false);
    }
  }

  async function createRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProject || submitting) {
      return;
    }

    setSubmitting(true);
    setCreateError(null);
    try {
      const response = await fetch("/api/analysis-runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceProject: selectedProject }),
      });
      if (!response.ok) {
        throw new Error(
          await responseError(response, "Analysis run could not be created"),
        );
      }
      const run: AnalysisRun = await response.json();
      latestRunsRequest.current += 1;
      setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
    } catch (error) {
      setCreateError(
        error instanceof Error
          ? error.message
          : "Analysis run could not be created",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="system-bar">
        <div className="product-mark" aria-label="Figma Make Analysis">
          <span className="product-monogram" aria-hidden="true">FM</span>
          <span>Figma Make Analysis</span>
        </div>
        <div className="system-state">
          <span className="system-state-dot" aria-hidden="true" />
          Local system
        </div>
      </header>

      <main className="workbench">
        <header className="workbench-heading">
          <p className="section-label">Source control / preparation</p>
          <h1>Source preparation ledger</h1>
          <p className="workbench-summary">
            Select a mounted project and preserve its source state before analysis.
          </p>
        </header>

        <div className="workbench-grid">
          <section className="source-control" aria-labelledby="source-heading">
            <div className="panel-heading">
              <p className="panel-index">Input</p>
              <h2 id="source-heading">Choose a source project</h2>
            </div>

            <form onSubmit={createRun}>
              <label htmlFor="source-project">Mounted project</label>
              <select
                id="source-project"
                value={selectedProject}
                onChange={(event) => setSelectedProject(event.target.value)}
                disabled={loadingSources || projects.length === 0 || submitting}
              >
                {projects.length === 0 ? (
                  <option value="">
                    {loadingSources ? "Loading source projects" : "No source projects found"}
                  </option>
                ) : (
                  projects.map((project) => (
                    <option key={project.relativePath} value={project.relativePath}>
                      {project.name}
                    </option>
                  ))
                )}
              </select>
              <button
                type="submit"
                disabled={
                  !selectedProject || loadingSources || loadingRuns || submitting
                }
              >
                {submitting ? "Creating analysis run" : "Create analysis run"}
              </button>
            </form>

            {sourceError ? (
              <p className="inline-error" role="alert">{sourceError}</p>
            ) : null}

            {createError ? (
              <p className="inline-error" role="alert">{createError}</p>
            ) : null}

            <dl className="boundary-note">
              <div>
                <dt>Source boundary</dt>
                <dd>Read only</dd>
              </div>
              <div>
                <dt>Selection scope</dt>
                <dd>Direct child folders</dd>
              </div>
            </dl>
          </section>

          <section className="run-ledger" aria-labelledby="runs-heading">
            <div className="panel-heading ledger-heading">
              <div>
                <p className="panel-index">History</p>
                <h2 id="runs-heading">Analysis runs</h2>
              </div>
              <span className="run-count" aria-label={`${runs.length} analysis runs`}>
                {String(runs.length).padStart(2, "0")}
              </span>
            </div>

            {listError ? (
              <p className="inline-error ledger-error" role="alert">{listError}</p>
            ) : null}

            <div aria-live="polite" aria-busy={loadingRuns}>
              {runs.length === 0 ? (
                <div className="empty-ledger">
                  <span className="empty-rule" aria-hidden="true" />
                  <p>No analysis runs yet</p>
                  <span>{loadingRuns ? "Checking saved runs" : "The next run will appear here"}</span>
                </div>
              ) : (
                <ol className="run-list">
                  {runs.map((run) => (
                    <li key={run.id} className={`run-entry status-${run.status}`}>
                      <span className="status-rail" aria-hidden="true" />
                      <article>
                        <header className="run-entry-heading">
                          <div>
                            <span className="status-label">{statusLabels[run.status]}</span>
                            <h3>{run.sourceRelativePath}</h3>
                          </div>
                          <time dateTime={run.updatedAt}>{formatTimestamp(run.updatedAt)}</time>
                        </header>

                        {run.sourceRevision ? (
                          <dl className="revision-specimen">
                            <div className="fingerprint-row">
                              <dt>Fingerprint</dt>
                              <dd><code>{run.sourceRevision.fingerprint}</code></dd>
                            </div>
                            <div>
                              <dt>Revision</dt>
                              <dd><code>{run.sourceRevision.id}</code></dd>
                            </div>
                            <div>
                              <dt>Snapshot</dt>
                              <dd><code>{run.sourceRevision.snapshotPath}</code></dd>
                            </div>
                            <div>
                              <dt>Working copy</dt>
                              <dd><code>{run.sourceRevision.workingCopyPath}</code></dd>
                            </div>
                          </dl>
                        ) : run.status === "awaiting-config" ? (
                          <div className="awaiting-config">
                            <p className="run-pending">
                              {run.startupContractReason || "Startup contract could not be determined"}
                            </p>
                            {overridingRunId === run.id ? (
                              <div className="override-form">
                                <label htmlFor={`pm-${run.id}`}>Package manager</label>
                                <select
                                  id={`pm-${run.id}`}
                                  value={overridePm}
                                  onChange={(e) => setOverridePm(e.target.value)}
                                  disabled={overrideSubmitting}
                                >
                                  <option value="">Auto-detect</option>
                                  <option value="npm">npm</option>
                                  <option value="yarn">yarn</option>
                                  <option value="pnpm">pnpm</option>
                                  <option value="bun">bun</option>
                                </select>
                                <label htmlFor={`script-${run.id}`}>Start script</label>
                                <input
                                  id={`script-${run.id}`}
                                  type="text"
                                  placeholder="e.g. dev, start"
                                  value={overrideScript}
                                  onChange={(e) => setOverrideScript(e.target.value)}
                                  disabled={overrideSubmitting}
                                />
                                {overrideError ? (
                                  <p className="inline-error" role="alert">{overrideError}</p>
                                ) : null}
                                <div className="override-actions">
                                  <button
                                    onClick={() => void submitOverride(run.id)}
                                    disabled={overrideSubmitting}
                                  >
                                    {overrideSubmitting ? "Saving" : "Save and retry"}
                                  </button>
                                  <button
                                    onClick={() => { setOverridingRunId(null); setOverrideError(null); }}
                                    disabled={overrideSubmitting}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                onClick={() => { setOverridingRunId(run.id); setOverridePm(""); setOverrideScript(""); setOverrideError(null); }}
                              >
                                Override startup contract
                              </button>
                            )}
                          </div>
                        ) : (
                          <p className="run-pending">
                            {run.status === "failed"
                              ? run.errorMessage || "Source preparation failed"
                              : "Waiting for the local worker"}
                          </p>
                        )}
                      </article>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
