"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ReviewStatus = "pending" | "confirmed" | "excluded" | "merged";

type CandidateScreen = {
  id: string;
  analysisRunId: string;
  route: string;
  uiFingerprint: string;
  visibleStateHash: string;
  operationPath: string[];
  screenshotPath: string | null;
  tracePath: string | null;
  incompleteReason: string | null;
  reviewStatus: ReviewStatus;
  screenTitle: string | null;
  screenNotes: string | null;
  mergedIntoId: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

type FilterTab = "all" | ReviewStatus;

const statusLabels: Record<ReviewStatus, string> = {
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

function defaultTitle(screen: CandidateScreen): string {
  return screen.screenTitle || screen.route || screen.id.slice(0, 8);
}

export function ScreenReview({ analysisRunId }: { analysisRunId: string }) {
  const [screens, setScreens] = useState<CandidateScreen[]>([]);
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
  const latestRequest = useRef(0);

  const loadScreens = useCallback(async () => {
    const req = ++latestRequest.current;
    try {
      const response = await fetch(
        `/api/analysis-runs/${analysisRunId}/candidate-screens`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        throw new Error(await responseError(response, "Candidate screens could not be loaded"));
      }
      const body: { screens: CandidateScreen[] } = await response.json();
      if (req === latestRequest.current) {
        setScreens(body.screens);
        setLoadError(null);
      }
    } catch (error) {
      if (req === latestRequest.current) {
        setLoadError(error instanceof Error ? error.message : "Candidate screens could not be loaded");
      }
    } finally {
      if (req === latestRequest.current) setLoading(false);
    }
  }, [analysisRunId]);

  useEffect(() => { void loadScreens(); }, [loadScreens]);

  const filtered = useMemo(
    () => filterTab === "all" ? screens : screens.filter((s) => s.reviewStatus === filterTab),
    [screens, filterTab],
  );

  const counts = useMemo(() => {
    const c: Record<FilterTab, number> = { all: screens.length, pending: 0, confirmed: 0, excluded: 0, merged: 0 };
    for (const s of screens) c[s.reviewStatus]++;
    return c;
  }, [screens]);

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
      setSelected(new Set(filtered.map((s) => s.id)));
    }
  }

  async function patchScreen(
    screenId: string,
    update: {
      reviewStatus: ReviewStatus;
      screenTitle?: string | null;
      screenNotes?: string | null;
      mergedIntoId?: string | null;
    },
  ) {
    const response = await fetch(
      `/api/analysis-runs/${analysisRunId}/candidate-screens/${screenId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(update),
      },
    );
    if (!response.ok) {
      throw new Error(await responseError(response, "Action failed"));
    }
    const updated: CandidateScreen = await response.json();
    setScreens((prev) => prev.map((s) => (s.id === screenId ? updated : s)));
  }

  async function batchReview(ids: string[], reviewStatus: ReviewStatus) {
    const response = await fetch(
      `/api/analysis-runs/${analysisRunId}/candidate-screens/batch-review`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids, reviewStatus }),
      },
    );
    if (!response.ok) {
      throw new Error(await responseError(response, "Batch action failed"));
    }
    const body: { screens: CandidateScreen[] } = await response.json();
    const updatedMap = new Map(body.screens.map((s) => [s.id, s]));
    setScreens((prev) => prev.map((s) => updatedMap.get(s.id) ?? s));
    setSelected(new Set());
  }

  async function handleSingleAction(screenId: string, status: ReviewStatus) {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await patchScreen(screenId, { reviewStatus: status });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleBatchAction(status: ReviewStatus) {
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

  async function handleSaveEdit(screenId: string) {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const screen = screens.find((s) => s.id === screenId);
      await patchScreen(screenId, {
        reviewStatus: screen?.reviewStatus ?? "confirmed",
        screenTitle: editTitle || null,
        screenNotes: editNotes || null,
      });
      setEditingId(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleMerge(screenId: string) {
    if (busy || !mergeTargetId) return;
    setBusy(true);
    setActionError(null);
    try {
      await patchScreen(screenId, { reviewStatus: "merged", mergedIntoId: mergeTargetId });
      setMergingId(null);
      setMergeTargetId("");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Merge failed");
    } finally {
      setBusy(false);
    }
  }

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
          Screen Review
        </div>
      </header>

      <main className="workbench">
        <header className="workbench-heading">
          <a href="/" className="review-back-link">← Back to runs</a>
          <p className="section-label">Human Review / Candidate Screens</p>
          <h1>Review candidate screens</h1>
          <p className="workbench-summary">
            Confirm, modify, merge, or exclude each candidate screen. Only confirmed screens become active inputs for downstream analysis.
          </p>
        </header>

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
              Select all {filterTab === "all" ? "" : statusLabels[filterTab as ReviewStatus]} ({filtered.length})
            </label>
          </div>
        ) : null}

        {loading ? (
          <div className="empty-ledger">
            <span className="empty-rule" aria-hidden="true" />
            <p>Loading candidate screens</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-ledger">
            <span className="empty-rule" aria-hidden="true" />
            <p>{screens.length === 0 ? "No candidate screens found" : "No screens match this filter"}</p>
          </div>
        ) : (
          <ol className="screen-list" aria-label="Candidate screens">
            {filtered.map((screen) => (
              <li key={screen.id} className={`screen-card status-${screen.reviewStatus}`}>
                <label className="screen-select-label" aria-label={`Select screen ${defaultTitle(screen)}`}>
                  <input
                    type="checkbox"
                    checked={selected.has(screen.id)}
                    onChange={() => toggleSelect(screen.id)}
                  />
                </label>

                <div className="screen-card-body">
                  <div className="screen-card-header">
                    <div className="screen-card-meta">
                      <span className={`status-badge status-badge-${screen.reviewStatus}`}>
                        {statusLabels[screen.reviewStatus]}
                      </span>
                      <h2 className="screen-card-title">{defaultTitle(screen)}</h2>
                      {screen.incompleteReason ? (
                        <span className="screen-incomplete">{screen.incompleteReason}</span>
                      ) : null}
                    </div>
                    <div className="screen-card-actions">
                      {screen.reviewStatus !== "confirmed" ? (
                        <button
                          className="btn-action btn-confirm"
                          onClick={() => void handleSingleAction(screen.id, "confirmed")}
                          disabled={busy}
                        >
                          Confirm
                        </button>
                      ) : null}
                      {screen.reviewStatus !== "excluded" ? (
                        <button
                          className="btn-action btn-exclude"
                          onClick={() => void handleSingleAction(screen.id, "excluded")}
                          disabled={busy}
                        >
                          Exclude
                        </button>
                      ) : null}
                      <button
                        className="btn-action btn-edit"
                        onClick={() => {
                          setEditingId(screen.id);
                          setEditTitle(screen.screenTitle ?? "");
                          setEditNotes(screen.screenNotes ?? "");
                          setMergingId(null);
                        }}
                        disabled={busy}
                      >
                        Edit
                      </button>
                      {screen.reviewStatus !== "merged" ? (
                        <button
                          className="btn-action btn-merge"
                          onClick={() => {
                            setMergingId(screen.id);
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
                    {screen.screenshotPath ? (
                      <div className="screen-screenshot-wrap">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/api/analysis-runs/${screen.analysisRunId}/candidate-screens/${screen.id}/screenshot`}
                          alt={`Screenshot of ${defaultTitle(screen)}`}
                          className="screen-screenshot"
                          loading="lazy"
                        />
                      </div>
                    ) : (
                      <div className="screen-no-screenshot">No screenshot</div>
                    )}

                    <dl className="screen-details">
                      <div>
                        <dt>Route</dt>
                        <dd><code>{screen.route}</code></dd>
                      </div>
                      <div>
                        <dt>ID</dt>
                        <dd><code>{screen.id}</code></dd>
                      </div>
                      {screen.operationPath.length > 0 ? (
                        <div>
                          <dt>Path</dt>
                          <dd><code>{screen.operationPath.join(" → ")}</code></dd>
                        </div>
                      ) : null}
                      {screen.mergedIntoId ? (
                        <div>
                          <dt>Merged into</dt>
                          <dd><code>{screen.mergedIntoId}</code></dd>
                        </div>
                      ) : null}
                      {screen.tracePath ? (
                        <div>
                          <dt>Trace</dt>
                          <dd><code>{screen.tracePath}</code></dd>
                        </div>
                      ) : null}
                      {screen.screenNotes ? (
                        <div>
                          <dt>Notes</dt>
                          <dd>{screen.screenNotes}</dd>
                        </div>
                      ) : null}
                    </dl>
                  </div>

                  {editingId === screen.id ? (
                    <div className="screen-edit-form">
                      <label htmlFor={`title-${screen.id}`}>Screen title</label>
                      <input
                        id={`title-${screen.id}`}
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        placeholder={screen.route}
                        disabled={busy}
                      />
                      <label htmlFor={`notes-${screen.id}`}>Notes</label>
                      <textarea
                        id={`notes-${screen.id}`}
                        value={editNotes}
                        onChange={(e) => setEditNotes(e.target.value)}
                        rows={3}
                        disabled={busy}
                      />
                      <div className="form-actions">
                        <button
                          onClick={() => void handleSaveEdit(screen.id)}
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

                  {mergingId === screen.id ? (
                    <div className="screen-merge-form">
                      <label htmlFor={`merge-target-${screen.id}`}>Merge into screen ID</label>
                      <select
                        id={`merge-target-${screen.id}`}
                        value={mergeTargetId}
                        onChange={(e) => setMergeTargetId(e.target.value)}
                        disabled={busy}
                      >
                        <option value="">Select target screen…</option>
                        {screens
                          .filter((s) => s.id !== screen.id && s.reviewStatus !== "excluded")
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              {defaultTitle(s)} ({s.route})
                            </option>
                          ))}
                      </select>
                      <div className="form-actions">
                        <button
                          onClick={() => void handleMerge(screen.id)}
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
