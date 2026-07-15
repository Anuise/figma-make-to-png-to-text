"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type WorkflowDraftReviewStatus = "pending" | "confirmed" | "excluded" | "merged";

type WorkflowDraft = {
  id: string;
  analysisRunId: string;
  workflowDraftJobId: string;
  userGoal: string;
  preconditions: string[];
  steps: string[];
  expectedResult: string;
  exceptions: string[];
  relatedScreenIds: string[];
  reviewStatus: WorkflowDraftReviewStatus;
  draftTitle: string | null;
  draftNotes: string | null;
  mergedIntoId: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

type AiExportPolicy = {
  analysisRunId: string;
  dataExportAllowed: boolean;
  aiNoticeAcknowledgedAt: string | null;
};

type WorkflowDraftJob = {
  id: string;
  analysisRunId: string;
  status: "queued" | "processing" | "completed" | "failed" | "awaiting-manual";
  attempts: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

type FilterTab = "all" | WorkflowDraftReviewStatus;

const statusLabels: Record<WorkflowDraftReviewStatus, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  excluded: "Excluded",
  merged: "Merged",
};

async function responseError(response: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") {
      return body.error;
    }
  } catch {}
  return fallback;
}

function defaultTitle(draft: WorkflowDraft): string {
  return draft.draftTitle || draft.userGoal || draft.id.slice(0, 8);
}

export function WorkflowReview({ analysisRunId }: { analysisRunId: string }) {
  const [drafts, setDrafts] = useState<WorkflowDraft[]>([]);
  const [policy, setPolicy] = useState<AiExportPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [mergingId, setMergingId] = useState<string | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateMessage, setGenerateMessage] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const latestRequest = useRef(0);

  const loadAll = useCallback(async () => {
    const req = ++latestRequest.current;
    try {
      const [draftsResponse, policyResponse] = await Promise.all([
        fetch(`/api/analysis-runs/${analysisRunId}/workflow-drafts`, { cache: "no-store" }),
        fetch(`/api/analysis-runs/${analysisRunId}/ai-export-policy`, { cache: "no-store" }),
      ]);
      if (!draftsResponse.ok) {
        throw new Error(await responseError(draftsResponse, "Workflow drafts could not be loaded"));
      }
      if (!policyResponse.ok) {
        throw new Error(await responseError(policyResponse, "AI export policy could not be loaded"));
      }
      const draftsBody: { drafts: WorkflowDraft[] } = await draftsResponse.json();
      const policyBody: { policy: AiExportPolicy } = await policyResponse.json();
      if (req === latestRequest.current) {
        setDrafts(draftsBody.drafts);
        setPolicy(policyBody.policy);
        setLoadError(null);
      }
    } catch (error) {
      if (req === latestRequest.current) {
        setLoadError(error instanceof Error ? error.message : "Workflow drafts could not be loaded");
      }
    } finally {
      if (req === latestRequest.current) setLoading(false);
    }
  }, [analysisRunId]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  const filtered = useMemo(
    () => filterTab === "all" ? drafts : drafts.filter((d) => d.reviewStatus === filterTab),
    [drafts, filterTab],
  );

  const counts = useMemo(() => {
    const c: Record<FilterTab, number> = { all: drafts.length, pending: 0, confirmed: 0, excluded: 0, merged: 0 };
    for (const d of drafts) c[d.reviewStatus]++;
    return c;
  }, [drafts]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === filtered.length && filtered.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((d) => d.id)));
    }
  }

  async function patchDraft(
    draftId: string,
    update: {
      reviewStatus: WorkflowDraftReviewStatus;
      draftTitle?: string | null;
      draftNotes?: string | null;
      mergedIntoId?: string | null;
    },
  ) {
    const response = await fetch(
      `/api/analysis-runs/${analysisRunId}/workflow-drafts/${draftId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(update),
      },
    );
    if (!response.ok) {
      throw new Error(await responseError(response, "Action failed"));
    }
    const updated: WorkflowDraft = await response.json();
    setDrafts((prev) => prev.map((d) => (d.id === draftId ? updated : d)));
  }

  async function batchReview(ids: string[], reviewStatus: WorkflowDraftReviewStatus) {
    const response = await fetch(
      `/api/analysis-runs/${analysisRunId}/workflow-drafts/batch-review`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids, reviewStatus }),
      },
    );
    if (!response.ok) {
      throw new Error(await responseError(response, "Batch action failed"));
    }
    const body: { drafts: WorkflowDraft[] } = await response.json();
    const updatedMap = new Map(body.drafts.map((d) => [d.id, d]));
    setDrafts((prev) => prev.map((d) => updatedMap.get(d.id) ?? d));
    setSelected(new Set());
  }

  async function handleSingleAction(draftId: string, status: WorkflowDraftReviewStatus) {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await patchDraft(draftId, { reviewStatus: status });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleBatchAction(status: WorkflowDraftReviewStatus) {
    if (busy || selected.size === 0) return;
    setBusy(true);
    setActionError(null);
    try {
      await batchReview([...selected], status);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Batch action failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveEdit(draftId: string) {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const draft = drafts.find((d) => d.id === draftId);
      await patchDraft(draftId, {
        reviewStatus: draft?.reviewStatus ?? "confirmed",
        draftTitle: editTitle || null,
        draftNotes: editNotes || null,
      });
      setEditingId(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleMerge(draftId: string) {
    if (busy || !mergeTargetId) return;
    setBusy(true);
    setActionError(null);
    try {
      await patchDraft(draftId, { reviewStatus: "merged", mergedIntoId: mergeTargetId });
      setMergingId(null);
      setMergeTargetId("");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Merge failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleAcknowledgeNotice() {
    setGenerateError(null);
    try {
      const response = await fetch(`/api/analysis-runs/${analysisRunId}/ai-export-policy`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ acknowledgeNotice: true }),
      });
      if (!response.ok) {
        throw new Error(await responseError(response, "Could not save acknowledgement"));
      }
      const body: { policy: AiExportPolicy } = await response.json();
      setPolicy(body.policy);
    } catch (error) {
      setGenerateError(error instanceof Error ? error.message : "Could not save acknowledgement");
    }
  }

  async function handleToggleDataExportAllowed(nextValue: boolean) {
    setGenerateError(null);
    try {
      const response = await fetch(`/api/analysis-runs/${analysisRunId}/ai-export-policy`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dataExportAllowed: nextValue }),
      });
      if (!response.ok) {
        throw new Error(await responseError(response, "Could not update policy"));
      }
      const body: { policy: AiExportPolicy } = await response.json();
      setPolicy(body.policy);
    } catch (error) {
      setGenerateError(error instanceof Error ? error.message : "Could not update policy");
    }
  }

  async function handleGenerate() {
    if (generating) return;
    setGenerating(true);
    setGenerateError(null);
    setGenerateMessage(null);
    try {
      const response = await fetch(`/api/analysis-runs/${analysisRunId}/workflow-drafts`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(await responseError(response, "Workflow drafts could not be generated"));
      }
      const body: { job: WorkflowDraftJob } = await response.json();
      setGenerateMessage(
        body.job.status === "awaiting-manual"
          ? "AI export is disabled for this run — these screens are pending manual review instead."
          : "Generation queued. Check back shortly, or use Refresh below once the ai-worker has finished.",
      );
      await loadAll();
    } catch (error) {
      setGenerateError(error instanceof Error ? error.message : "Workflow drafts could not be generated");
    } finally {
      setGenerating(false);
    }
  }

  const dataExportAllowed = policy?.dataExportAllowed ?? true;
  const noticeAcknowledged = Boolean(policy?.aiNoticeAcknowledgedAt);
  const canGenerate = dataExportAllowed ? noticeAcknowledged : true;

  const filterTabs: FilterTab[] = ["all", "pending", "confirmed", "excluded", "merged"];

  return (
    <div className="app-shell">
      <header className="system-bar">
        <div className="product-mark" aria-label="Figma Make Analysis">
          <span className="product-monogram" aria-hidden="true">FM</span>
          <span>Figma Make Analysis</span>
        </div>
        <div className="system-state">
          <span className="system-state-dot" aria-hidden="true" />
          Workflow Review
        </div>
      </header>

      <main className="workbench">
        <header className="workbench-heading">
          <a href="/" className="review-back-link">← Back to runs</a>
          <p className="section-label">Human Review / Workflow Drafts</p>
          <h1>Review workflow drafts</h1>
          <p className="workbench-summary">
            Confirm, modify, merge, or exclude each workflow draft. Only confirmed drafts become active inputs for downstream analysis.
          </p>
        </header>

        <section className="generate-panel" aria-labelledby="generate-heading">
          <div className="panel-heading">
            <p className="panel-index">AI</p>
            <h2 id="generate-heading">Generate workflow drafts</h2>
          </div>

          {dataExportAllowed ? (
            <>
              <p className="ai-notice">
                Free Tier inputs may be used by Google to improve their products. Screenshots, notes,
                and any matched code snippets for confirmed-but-not-yet-drafted screens will be sent to
                the Antigravity SDK before each generation.
              </p>
              <label className="review-checkbox-label">
                <input
                  type="checkbox"
                  checked={noticeAcknowledged}
                  onChange={(event) => {
                    if (event.target.checked) void handleAcknowledgeNotice();
                  }}
                  disabled={noticeAcknowledged}
                />
                I acknowledge the Free Tier data usage notice
              </label>
            </>
          ) : (
            <p className="ai-notice">
              AI export is disabled for this analysis run. Generating will move confirmed screens
              straight to pending manual review — you can still confirm, modify, merge, or exclude
              workflow drafts by hand.
            </p>
          )}

          <label className="review-checkbox-label">
            <input
              type="checkbox"
              checked={dataExportAllowed}
              onChange={(event) => void handleToggleDataExportAllowed(event.target.checked)}
            />
            Allow sending data to the Antigravity SDK for this run
          </label>

          <div className="form-actions">
            <button onClick={() => void handleGenerate()} disabled={generating || !canGenerate}>
              {generating ? "Generating…" : "Generate workflow drafts"}
            </button>
            <button onClick={() => void loadAll()} disabled={loading}>
              Refresh
            </button>
          </div>

          {generateMessage ? <p className="run-pending">{generateMessage}</p> : null}
          {generateError ? <p className="inline-error" role="alert">{generateError}</p> : null}
        </section>

        {loadError ? (
          <p className="inline-error" role="alert">{loadError}</p>
        ) : null}

        {actionError ? (
          <p className="inline-error" role="alert">{actionError}</p>
        ) : null}

        <div className="review-toolbar">
          <div className="review-tabs" role="tablist" aria-label="Filter by status">
            {filterTabs.map((tab) => (
              <button
                key={tab}
                role="tab"
                aria-selected={filterTab === tab}
                className={`review-tab${filterTab === tab ? " review-tab-active" : ""}`}
                onClick={() => { setFilterTab(tab); setSelected(new Set()); }}
              >
                {tab === "all" ? "All" : statusLabels[tab]}
                <span className="review-tab-count">{counts[tab]}</span>
              </button>
            ))}
          </div>

          {selected.size > 0 ? (
            <div className="batch-actions">
              <span className="batch-label">{selected.size} selected</span>
              <button
                className="btn-action btn-confirm"
                onClick={() => void handleBatchAction("confirmed")}
                disabled={busy}
              >
                Confirm all
              </button>
              <button
                className="btn-action btn-exclude"
                onClick={() => void handleBatchAction("excluded")}
                disabled={busy}
              >
                Exclude all
              </button>
              <button
                className="btn-action btn-reset"
                onClick={() => void handleBatchAction("pending")}
                disabled={busy}
              >
                Reset to pending
              </button>
            </div>
          ) : null}
        </div>

        {!loading && filtered.length > 0 ? (
          <div className="review-select-all">
            <label className="review-checkbox-label">
              <input
                type="checkbox"
                checked={selected.size === filtered.length && filtered.length > 0}
                onChange={toggleSelectAll}
              />
              Select all {filterTab === "all" ? "" : statusLabels[filterTab as WorkflowDraftReviewStatus]} ({filtered.length})
            </label>
          </div>
        ) : null}

        {loading ? (
          <div className="empty-ledger">
            <span className="empty-rule" aria-hidden="true" />
            <p>Loading workflow drafts</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-ledger">
            <span className="empty-rule" aria-hidden="true" />
            <p>{drafts.length === 0 ? "No workflow drafts yet" : "No drafts match this filter"}</p>
          </div>
        ) : (
          <ol className="screen-list" aria-label="Workflow drafts">
            {filtered.map((draft) => (
              <li key={draft.id} className={`screen-card status-${draft.reviewStatus}`}>
                <label className="screen-select-label" aria-label={`Select draft ${defaultTitle(draft)}`}>
                  <input
                    type="checkbox"
                    checked={selected.has(draft.id)}
                    onChange={() => toggleSelect(draft.id)}
                  />
                </label>

                <div className="screen-card-body">
                  <div className="screen-card-header">
                    <div className="screen-card-meta">
                      <span className={`status-badge status-badge-${draft.reviewStatus}`}>
                        {statusLabels[draft.reviewStatus]}
                      </span>
                      <h2 className="screen-card-title">{defaultTitle(draft)}</h2>
                    </div>
                    <div className="screen-card-actions">
                      {draft.reviewStatus !== "confirmed" ? (
                        <button
                          className="btn-action btn-confirm"
                          onClick={() => void handleSingleAction(draft.id, "confirmed")}
                          disabled={busy}
                        >
                          Confirm
                        </button>
                      ) : null}
                      {draft.reviewStatus !== "excluded" ? (
                        <button
                          className="btn-action btn-exclude"
                          onClick={() => void handleSingleAction(draft.id, "excluded")}
                          disabled={busy}
                        >
                          Exclude
                        </button>
                      ) : null}
                      <button
                        className="btn-action btn-edit"
                        onClick={() => {
                          setEditingId(draft.id);
                          setEditTitle(draft.draftTitle ?? "");
                          setEditNotes(draft.draftNotes ?? "");
                          setMergingId(null);
                        }}
                        disabled={busy}
                      >
                        Edit
                      </button>
                      {draft.reviewStatus !== "merged" ? (
                        <button
                          className="btn-action btn-merge"
                          onClick={() => {
                            setMergingId(draft.id);
                            setMergeTargetId("");
                            setEditingId(null);
                          }}
                          disabled={busy}
                        >
                          Merge into…
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <div className="screen-card-content">
                    <dl className="screen-details">
                      <div>
                        <dt>Goal</dt>
                        <dd>{draft.userGoal}</dd>
                      </div>
                      {draft.preconditions.length > 0 ? (
                        <div>
                          <dt>Preconditions</dt>
                          <dd>{draft.preconditions.join("; ")}</dd>
                        </div>
                      ) : null}
                      <div>
                        <dt>Steps</dt>
                        <dd><code>{draft.steps.join(" → ")}</code></dd>
                      </div>
                      <div>
                        <dt>Expected result</dt>
                        <dd>{draft.expectedResult}</dd>
                      </div>
                      {draft.exceptions.length > 0 ? (
                        <div>
                          <dt>Exceptions</dt>
                          <dd>{draft.exceptions.join("; ")}</dd>
                        </div>
                      ) : null}
                      {draft.relatedScreenIds.length > 0 ? (
                        <div>
                          <dt>Related screens</dt>
                          <dd className="related-screens">
                            {draft.relatedScreenIds.map((screenId) => (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                key={screenId}
                                src={`/api/analysis-runs/${draft.analysisRunId}/candidate-screens/${screenId}/screenshot`}
                                alt="Related screen screenshot"
                                className="screen-screenshot-thumb"
                                loading="lazy"
                              />
                            ))}
                          </dd>
                        </div>
                      ) : null}
                      {draft.mergedIntoId ? (
                        <div>
                          <dt>Merged into</dt>
                          <dd><code>{draft.mergedIntoId}</code></dd>
                        </div>
                      ) : null}
                      {draft.draftNotes ? (
                        <div>
                          <dt>Notes</dt>
                          <dd>{draft.draftNotes}</dd>
                        </div>
                      ) : null}
                    </dl>
                  </div>

                  {editingId === draft.id ? (
                    <div className="screen-edit-form">
                      <label htmlFor={`title-${draft.id}`}>Draft title</label>
                      <input
                        id={`title-${draft.id}`}
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        placeholder={draft.userGoal}
                        disabled={busy}
                      />
                      <label htmlFor={`notes-${draft.id}`}>Notes</label>
                      <textarea
                        id={`notes-${draft.id}`}
                        value={editNotes}
                        onChange={(e) => setEditNotes(e.target.value)}
                        rows={3}
                        disabled={busy}
                      />
                      <div className="form-actions">
                        <button
                          onClick={() => void handleSaveEdit(draft.id)}
                          disabled={busy}
                        >
                          {busy ? "Saving…" : "Save"}
                        </button>
                        <button onClick={() => setEditingId(null)} disabled={busy}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {mergingId === draft.id ? (
                    <div className="screen-merge-form">
                      <label htmlFor={`merge-target-${draft.id}`}>Merge into draft ID</label>
                      <select
                        id={`merge-target-${draft.id}`}
                        value={mergeTargetId}
                        onChange={(e) => setMergeTargetId(e.target.value)}
                        disabled={busy}
                      >
                        <option value="">Select target draft…</option>
                        {drafts
                          .filter((d) => d.id !== draft.id && d.reviewStatus !== "excluded")
                          .map((d) => (
                            <option key={d.id} value={d.id}>
                              {defaultTitle(d)}
                            </option>
                          ))}
                      </select>
                      <div className="form-actions">
                        <button
                          onClick={() => void handleMerge(draft.id)}
                          disabled={busy || !mergeTargetId}
                        >
                          {busy ? "Merging…" : "Merge"}
                        </button>
                        <button onClick={() => setMergingId(null)} disabled={busy}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </main>
    </div>
  );
}
