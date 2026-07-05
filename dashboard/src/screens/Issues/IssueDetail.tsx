import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, Eye, FileCode2, GitPullRequest, WandSparkles } from "lucide-react";
import {
  applyAllFixes,
  applyIssueFix,
  createPullRequest,
  fetchProjectReadiness,
  finishProjectInit,
  prepareProjectForPullRequests,
  type IssueNameMap,
  type ProjectReadiness
} from "../../api/mutations";
import { IssueBadge } from "../../components/IssueBadge/IssueBadge";
import { ReviewActions } from "../../components/ReviewActions";
import { ScreenshotViewer } from "../../components/ScreenshotViewer/ScreenshotViewer";
import { UnifiedDiff } from "../../components/UnifiedDiff/UnifiedDiff";
import { patchPreviewForFix } from "../../lib/patch";
import { issueLabel } from "../../hooks/useIssueNames";
import type { ReviewStatus } from "../../state/review-state";
import type { DriftIssue } from "../../types/report";

export function IssueDetail({
  apiBaseUrl,
  applyEnabled,
  issue,
  issueNames,
  mutationToken,
  mutationBusy = false,
  onMutationBusyChange,
  onNavigateIssue,
  onReviewStatusChange,
  resolveAssetUrl,
  runId
}: {
  apiBaseUrl?: string;
  applyEnabled?: boolean;
  issue?: DriftIssue;
  issueNames: IssueNameMap;
  mutationToken?: string;
  mutationBusy?: boolean;
  onMutationBusyChange?: (busy: boolean) => void;
  onNavigateIssue?: (issueId: string) => void;
  onReviewStatusChange?: (status: ReviewStatus) => void;
  resolveAssetUrl: (path: string) => string;
  runId: string;
}) {
  const [applyState, setApplyState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [applyMessage, setApplyMessage] = useState<string>();
  const [prUrl, setPrUrl] = useState<string>();
  const [projectStatus, setProjectStatus] = useState<ProjectReadiness>();
  const issueIdRef = useRef(issue?.id);

  issueIdRef.current = issue?.id;

  useEffect(() => {
    setApplyState("idle");
    setApplyMessage(undefined);
    setPrUrl(undefined);
  }, [issue?.id]);

  useEffect(() => {
    if (!apiBaseUrl || !applyEnabled) {
      setProjectStatus(undefined);
      return;
    }

    let cancelled = false;
    fetchProjectReadiness(apiBaseUrl, runId, mutationToken)
      .then((status) => {
        if (!cancelled) {
          setProjectStatus(status);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, applyEnabled, mutationToken, runId]);

  if (!issue) {
    return (
      <section className="issue-detail issue-detail--empty" aria-label="Issue detail">
        <h2>Select a finding</h2>
      </section>
    );
  }

  const evidence = issue.evidence;
  const screenshotUrl = evidence?.screenshotPath
    ? resolveAssetUrl(evidence.screenshotPath)
    : undefined;
  const displayName = issueLabel(issue, issueNames);
  const issueId = issue.id;
  const patch = patchPreviewForFix(issue.suggestedFix);
  const patchBefore = patch?.before ?? "";
  const patchAfter = patch?.after ?? "";
  const relatedIssues =
    evidence?.relatedIssueIds
      ?.map((id) => ({ id, name: issueNames[id] }))
      .filter((entry): entry is { id: string; name: string } => Boolean(entry.name)) ?? [];
  const groupedObservationCount = (evidence?.relatedIssueIds?.length ?? 0) - relatedIssues.length;

  async function handleApplyFix() {
    if (!apiBaseUrl || !applyEnabled || mutationBusy) {
      return;
    }
    onMutationBusyChange?.(true);
    setApplyState("busy");
    setApplyMessage(undefined);
    const startedOn = issueId;
    try {
      const result = await applyIssueFix(apiBaseUrl, runId, issueId, mutationToken);
      if (issueIdRef.current !== startedOn) {
        return;
      }
      if (result.ok) {
        setApplyState("done");
        setApplyMessage("Fix applied to source file.");
      } else {
        setApplyState("error");
        setApplyMessage(result.error ?? "Could not apply fix.");
      }
    } catch (error) {
      if (issueIdRef.current !== startedOn) {
        return;
      }
      setApplyState("error");
      setApplyMessage(error instanceof Error ? error.message : "Could not apply fix.");
    } finally {
      onMutationBusyChange?.(false);
    }
  }

  async function handleApplyAll() {
    if (!apiBaseUrl || !applyEnabled || mutationBusy) {
      return;
    }
    onMutationBusyChange?.(true);
    setApplyMessage(undefined);
    const startedOn = issueId;
    try {
      const result = await applyAllFixes(apiBaseUrl, runId, undefined, mutationToken);
      if (issueIdRef.current !== startedOn) {
        return;
      }
      setApplyMessage(`Applied ${result.applied} fix${result.applied === 1 ? "" : "es"}.`);
      if (result.skipped.length) {
        setApplyMessage(
          `Applied ${result.applied}. Skipped ${result.skipped.length} (snippet not found).`
        );
      }
    } catch (error) {
      if (issueIdRef.current !== startedOn) {
        return;
      }
      setApplyMessage(error instanceof Error ? error.message : "Apply all failed.");
    } finally {
      onMutationBusyChange?.(false);
    }
  }

  async function handleCreatePr() {
    if (!apiBaseUrl || !applyEnabled || mutationBusy) {
      return;
    }
    onMutationBusyChange?.(true);
    setApplyMessage(undefined);
    const startedOn = issueId;
    try {
      const status = await prepareProjectForPullRequests(apiBaseUrl, runId, mutationToken);
      if (issueIdRef.current !== startedOn) {
        return;
      }
      setProjectStatus(status);
      if (status.state !== "ready") {
        setApplyMessage(projectStatusMessage(status));
        return;
      }

      const result = await createPullRequest(apiBaseUrl, runId, mutationToken);
      if (issueIdRef.current !== startedOn) {
        return;
      }
      if (result.prUrl) {
        setPrUrl(result.prUrl);
        setApplyMessage("Pull request created.");
      } else {
        setApplyMessage(result.error ?? "PR creation needs gh CLI and a git repo.");
      }
    } catch (error) {
      if (issueIdRef.current !== startedOn) {
        return;
      }
      setApplyMessage(error instanceof Error ? error.message : "PR creation failed.");
    } finally {
      onMutationBusyChange?.(false);
    }
  }

  async function handleFinishInit() {
    if (!apiBaseUrl || !applyEnabled || mutationBusy) {
      return;
    }

    onMutationBusyChange?.(true);
    setApplyMessage(undefined);
    try {
      const status = await finishProjectInit(apiBaseUrl, runId, mutationToken);
      setProjectStatus(status);
      setApplyMessage(projectStatusMessage(status));
    } catch (error) {
      setApplyMessage(error instanceof Error ? error.message : "Initial commit failed.");
    } finally {
      onMutationBusyChange?.(false);
    }
  }

  return (
    <section className="issue-detail" aria-label="Issue detail">
      <div className="detail-heading">
        <div className="detail-heading__copy">
          <p className="eyebrow" title={issue.id}>
            Finding · {issue.routeId}
          </p>
          <h2>{displayName}</h2>
        </div>
        <div className="badge-row">
          <IssueBadge value={issue.severity} kind="severity" />
          <IssueBadge value={issue.category} kind="category" />
          {issue.aiEnriched ? <span className="ai-badge">AI</span> : null}
        </div>
      </div>

      <div className="detail-grid">
        <div>
          <h3 className="section-label">
            <Eye size={14} aria-hidden /> Reasoning
          </h3>
          <p>{issue.reasoning}</p>
        </div>
        <dl className="metadata-grid">
          <Meta
            icon={<WandSparkles size={14} />}
            label="Confidence"
            value={`${Math.round(issue.confidence * 100)}%`}
          />
          <Meta icon={<FileCode2 size={14} />} label="Property" value={issue.property} />
          <Meta icon={<Eye size={14} />} label="Route" value={issue.routeId} />
          <Meta icon={<Eye size={14} />} label="Viewport" value={issue.viewport} />
          <Meta icon={<Eye size={14} />} label="State" value={issue.state} />
          <Meta icon={<FileCode2 size={14} />} label="Selector" value={issue.selectorHint ?? "—"} />
        </dl>
      </div>

      <ScreenshotViewer
        alt={`${displayName} screenshot evidence`}
        cropBox={evidence?.cropBox}
        src={screenshotUrl}
      />

      <dl className="evidence-grid">
        <Meta label="Observed" value={issue.observedValue} />
        <Meta label="Expected" value={issue.expectedValue ?? "—"} />
        <Meta label="Token" value={issue.nearestToken ?? "—"} />
        <Meta label="Distance" value={String(evidence?.tokenDistance ?? "—")} />
        <Meta label="Count" value={String(evidence?.occurrenceCount ?? "—")} />
      </dl>

      <section className="fix-panel">
        <div className="fix-panel__header">
          <h3 className="section-label">
            <WandSparkles size={14} aria-hidden /> Suggested fix
          </h3>
          <div className="fix-panel__actions">
            {issue.suggestedFix ? (
              <button
                type="button"
                className="button button--primary"
                disabled={!applyEnabled || applyState === "busy" || mutationBusy}
                onClick={handleApplyFix}
                title="Apply fix to source file"
              >
                <CheckCircle2 size={15} aria-hidden />
                {applyState === "done" ? "Applied" : "Apply fix"}
              </button>
            ) : null}
            {applyEnabled ? (
              <>
                <button
                  type="button"
                  className="button"
                  disabled={mutationBusy}
                  onClick={handleApplyAll}
                  title="Apply all fixes in this run"
                >
                  Apply all
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={mutationBusy}
                  onClick={handleCreatePr}
                  title="Create pull request from applied fixes"
                >
                  <GitPullRequest size={15} aria-hidden />
                  Create PR
                </button>
              </>
            ) : null}
          </div>
        </div>
        <p className="fix-panel__instruction">{issue.suggestedFix?.humanInstruction}</p>
        {applyMessage ? <p className="fix-panel__status">{applyMessage}</p> : null}
        {projectStatus && projectStatus.state !== "ready" ? (
          <ProjectReadinessCallout
            busy={mutationBusy}
            onFinishInit={handleFinishInit}
            status={projectStatus}
          />
        ) : null}
        {prUrl ? (
          <p className="fix-panel__status">
            <a href={prUrl} rel="noreferrer" target="_blank">
              Open pull request
            </a>
          </p>
        ) : null}
        <UnifiedDiff
          before={patchBefore}
          after={patchAfter}
          filePath={issue.suggestedFix?.sourceFile}
        />
      </section>

      {relatedIssues.length || groupedObservationCount > 0 ? (
        <section className="related-issues">
          <h3 className="section-label">Related</h3>
          {relatedIssues.length ? (
            <ul>
              {relatedIssues.map((related) => (
                <li key={related.id}>
                  <button
                    type="button"
                    className="related-issues__link"
                    onClick={() => onNavigateIssue?.(related.id)}
                  >
                    {related.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {groupedObservationCount > 0 ? (
            <p className="related-issues__summary">
              {groupedObservationCount} similar observation
              {groupedObservationCount === 1 ? "" : "s"} grouped into this finding.
            </p>
          ) : null}
        </section>
      ) : null}

      <div
        className="review-actions-slot"
        data-review-actions-slot
        aria-label="Review actions slot"
      >
        <ReviewActions issueId={issue.id} onStatusChange={onReviewStatusChange} runId={runId} />
      </div>
    </section>
  );
}

function ProjectReadinessCallout({
  busy,
  onFinishInit,
  status
}: {
  busy: boolean;
  onFinishInit: () => void;
  status: ProjectReadiness;
}) {
  if (status.state === "ready") {
    return null;
  }

  return (
    <div className="project-readiness" role="status">
      <p>{projectStatusMessage(status)}</p>
      {status.state === "needs_remote" ? (
        <>
          <code>{status.command}</code>
          <button className="button" disabled={busy} onClick={onFinishInit} type="button">
            Finish init
          </button>
        </>
      ) : null}
      {status.state === "needs_initial_commit" ? (
        <button className="button" disabled={busy} onClick={onFinishInit} type="button">
          Finish init
        </button>
      ) : null}
    </div>
  );
}

function projectStatusMessage(status: ProjectReadiness): string {
  if (status.state === "needs_git_init") {
    return "Project needs git init before PRs.";
  }
  if (status.state === "needs_remote") {
    return status.message;
  }
  if (status.state === "needs_initial_commit") {
    return status.message;
  }
  if (status.state === "no_source") {
    return status.message;
  }
  if (status.state === "error") {
    return status.message;
  }
  return status.message;
}

function Meta({ icon, label, value }: { icon?: ReactNode; label: string; value: string }) {
  return (
    <div>
      <dt>
        {icon ? <span className="meta-icon">{icon}</span> : null}
        {label}
      </dt>
      <dd>{value}</dd>
    </div>
  );
}
