import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownAZ,
  Filter,
  LayoutGrid,
  MapPin,
  Search,
  SlidersHorizontal
} from "lucide-react";
import { FloatingCopilot } from "../../components/CopilotPanel/CopilotPanel";
import { IssueBadge } from "../../components/IssueBadge/IssueBadge";
import { ReviewStatusBadge } from "../../components/ReviewStatusBadge";
import { issueLabel, useIssueNames } from "../../hooks/useIssueNames";
import {
  filterIssues,
  sortIssues,
  uniqueIssueValues,
  type IssueFilters,
  type IssueSort
} from "../../lib/filtering/issues";
import { getIssueReviewStatus, type ReviewStatus } from "../../state/review-state";
import type { DriftIssue, DriftReport, IssueCategory, IssueSeverity } from "../../types/report";
import { IssueDetail } from "./IssueDetail";
import "./Issues.css";

const severityOptions: Array<IssueSeverity | "all"> = ["all", "critical", "high", "medium", "low"];
const categoryOptions: Array<IssueCategory | "all"> = [
  "all",
  "token_misuse",
  "new_pattern_candidate",
  "accidental_regression",
  "acceptable_exception"
];
const sortOptions: IssueSort[] = ["severity", "confidence", "route", "category", "title"];

export function IssueWorkbench({
  apiBaseUrl,
  connectionMode,
  mutationToken,
  report,
  resolveAssetUrl
}: {
  apiBaseUrl: string;
  connectionMode: "live" | "fixture" | "no-runs" | "disconnected";
  mutationToken?: string;
  report: DriftReport;
  resolveAssetUrl: (path: string) => string;
}) {
  const [filters, setFilters] = useState<IssueFilters>(() =>
    filtersFromSearch(window.location.search)
  );
  const [sort, setSort] = useState<IssueSort>(() => sortFromSearch(window.location.search));
  const [selectedIssueId, setSelectedIssueId] = useState<string | undefined>(
    () => new URLSearchParams(window.location.search).get("issue") ?? undefined
  );
  const [reviewStatuses, setReviewStatuses] = useState<Record<string, ReviewStatus>>(() =>
    readReviewStatuses(report)
  );
  const [mutationBusy, setMutationBusy] = useState(false);
  const [pinnedSelection, setPinnedSelection] = useState(false);
  const issueNames = useIssueNames(
    apiBaseUrl,
    report.runId,
    report.issues,
    connectionMode === "live",
    mutationToken
  );

  const visibleIssues = useMemo(
    () => sortIssues(filterIssues(report.issues, filters), sort),
    [filters, report.issues, sort]
  );
  const selectedIssue =
    report.issues.find((issue) => issue.id === selectedIssueId) ??
    visibleIssues.find((issue) => issue.id === selectedIssueId) ??
    visibleIssues[0];

  useEffect(() => {
    if (!visibleIssues.length) {
      if (selectedIssueId) {
        setSelectedIssueId(undefined);
        setPinnedSelection(false);
        replaceIssueQuery(filters, sort, report.runId);
      }
      return;
    }

    if (
      pinnedSelection &&
      selectedIssueId &&
      report.issues.some((issue) => issue.id === selectedIssueId)
    ) {
      const currentRunId = new URLSearchParams(window.location.search).get("runId");
      if (currentRunId !== report.runId && selectedIssue) {
        replaceIssueQuery(filters, sort, report.runId, selectedIssue.id);
      }
      return;
    }

    if (!visibleIssues.some((issue) => issue.id === selectedIssueId)) {
      const nextIssueId = visibleIssues[0].id;
      setSelectedIssueId(nextIssueId);
      setPinnedSelection(false);
      replaceIssueQuery(filters, sort, report.runId, nextIssueId);
      return;
    }

    const currentRunId = new URLSearchParams(window.location.search).get("runId");
    if (currentRunId !== report.runId && selectedIssue) {
      replaceIssueQuery(filters, sort, report.runId, selectedIssue.id);
    }
  }, [
    filters,
    pinnedSelection,
    report.issues,
    report.runId,
    selectedIssue,
    selectedIssueId,
    sort,
    visibleIssues
  ]);

  useEffect(() => {
    setReviewStatuses(readReviewStatuses(report));
  }, [report]);

  function updateFilter<K extends keyof IssueFilters>(key: K, value: IssueFilters[K]) {
    setPinnedSelection(false);
    setFilters((current) => {
      const next = { ...current, [key]: value || undefined };
      replaceIssueQuery(next, sort, report.runId, selectedIssueId);
      return next;
    });
  }

  function selectIssue(issueId: string, pin = false) {
    setSelectedIssueId(issueId);
    setPinnedSelection(pin);
    replaceIssueQuery(filters, sort, report.runId, issueId);
  }

  function updateReviewStatus(issueId: string, status: ReviewStatus) {
    setReviewStatuses((current) => ({ ...current, [issueId]: status }));
  }

  function updateSort(next: IssueSort) {
    setSort(next);
    replaceIssueQuery(filters, next, report.runId, selectedIssueId);
  }

  return (
    <section className="issues-workbench">
      <header className="workbench-header">
        <div>
          <p className="eyebrow">{report.runId}</p>
          <h2>Issues</h2>
        </div>
        <p className="workbench-header__count">
          {visibleIssues.length}/{report.issues.length}
        </p>
      </header>

      <div className="issue-filters" aria-label="Issue filters">
        <label className="issue-filters__search">
          <Search size={14} aria-hidden />
          <input
            type="search"
            value={filters.query ?? ""}
            onChange={(event) => updateFilter("query", event.target.value)}
            placeholder="Search…"
            aria-label="Search issues"
          />
        </label>
        <FilterSelect
          icon={<Filter size={14} />}
          label="Severity"
          value={filters.severity ?? "all"}
          options={severityOptions}
          onChange={(value) => updateFilter("severity", value as IssueSeverity | "all")}
        />
        <FilterSelect
          icon={<LayoutGrid size={14} />}
          label="Category"
          value={filters.category ?? "all"}
          options={categoryOptions}
          onChange={(value) => updateFilter("category", value as IssueCategory | "all")}
        />
        <FilterSelect
          icon={<SlidersHorizontal size={14} />}
          label="Property"
          value={filters.property ?? ""}
          options={["", ...uniqueIssueValues(report.issues, "property")]}
          onChange={(value) => updateFilter("property", value)}
        />
        <FilterSelect
          icon={<MapPin size={14} />}
          label="Route"
          value={filters.route ?? ""}
          options={["", ...uniqueIssueValues(report.issues, "routeId")]}
          onChange={(value) => updateFilter("route", value)}
        />
        <FilterSelect
          icon={<SlidersHorizontal size={14} />}
          label="State"
          value={filters.state ?? ""}
          options={["", ...uniqueIssueValues(report.issues, "state")]}
          onChange={(value) => updateFilter("state", value)}
        />
        <FilterSelect
          icon={<ArrowDownAZ size={14} />}
          label="Sort"
          value={sort}
          options={sortOptions}
          onChange={(value) => updateSort(value as IssueSort)}
        />
      </div>

      <div className="workbench-grid">
        <aside className="issue-list" aria-label="Issue list">
          {visibleIssues.length ? (
            visibleIssues.map((issue, index) => (
              <IssueRow
                displayName={issueLabel(issue, issueNames)}
                issue={issue}
                key={issue.id}
                onSelect={() => selectIssue(issue.id)}
                onStep={(step, row) => {
                  const next = visibleIssues[index + step];
                  if (next) {
                    selectIssue(next.id);
                    const rows =
                      row.parentElement?.querySelectorAll<HTMLButtonElement>(".issue-row");
                    rows?.[index + step]?.focus();
                  }
                }}
                reviewStatus={reviewStatuses[issue.id] ?? "generated"}
                selected={issue.id === selectedIssue?.id}
              />
            ))
          ) : (
            <div className="no-results">
              <strong>No matches</strong>
            </div>
          )}
        </aside>
        <IssueDetail
          apiBaseUrl={apiBaseUrl}
          applyEnabled={connectionMode === "live"}
          issue={selectedIssue}
          issueNames={issueNames}
          mutationToken={mutationToken}
          mutationBusy={mutationBusy}
          onMutationBusyChange={setMutationBusy}
          onNavigateIssue={(issueId) => selectIssue(issueId, true)}
          onReviewStatusChange={(status) => {
            if (selectedIssue) updateReviewStatus(selectedIssue.id, status);
          }}
          resolveAssetUrl={resolveAssetUrl}
          runId={report.runId}
        />
      </div>

      <FloatingCopilot
        apiBaseUrl={apiBaseUrl}
        enabled={connectionMode === "live"}
        issue={selectedIssue}
        issueLabel={selectedIssue ? issueLabel(selectedIssue, issueNames) : undefined}
        mutationToken={mutationToken}
        runId={report.runId}
      />
    </section>
  );
}

function readReviewStatuses(report: DriftReport): Record<string, ReviewStatus> {
  return Object.fromEntries(
    report.issues.map((issue) => [
      issue.id,
      getIssueReviewStatus(localStorage, report.runId, issue.id)
    ])
  );
}

function filtersFromSearch(search: string): IssueFilters {
  const params = new URLSearchParams(search);
  const severity = params.get("severity");
  const category = params.get("category");

  return {
    severity: severityOptions.includes(severity as IssueSeverity)
      ? (severity as IssueSeverity)
      : "all",
    category: categoryOptions.includes(category as IssueCategory)
      ? (category as IssueCategory)
      : "all",
    property: params.get("property") || undefined,
    route: params.get("route") || undefined,
    state: params.get("state") || undefined,
    query: params.get("query") || undefined
  };
}

function sortFromSearch(search: string): IssueSort {
  const sort = new URLSearchParams(search).get("sort") as IssueSort | null;
  return sort && sortOptions.includes(sort) ? sort : "severity";
}

function replaceIssueQuery(
  filters: IssueFilters,
  sort: IssueSort,
  runId: string,
  issueId?: string
) {
  const params = new URLSearchParams(window.location.search);
  params.set("runId", runId);

  for (const key of ["severity", "category", "property", "route", "state", "query"] as const) {
    const value = filters[key];
    if (!value || value === "all") {
      params.delete(key);
    } else {
      params.set(key, value);
    }
  }

  if (sort === "severity") {
    params.delete("sort");
  } else {
    params.set("sort", sort);
  }

  if (issueId) {
    params.set("issue", issueId);
  } else {
    params.delete("issue");
  }

  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`
  );
}

function FilterSelect({
  icon,
  label,
  onChange,
  options,
  value
}: {
  icon?: React.ReactNode;
  label: string;
  onChange: (value: string) => void;
  options: string[];
  value: string;
}) {
  return (
    <label>
      <span className="issue-filters__label">
        {icon}
        <span>{label}</span>
      </span>
      <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={label}>
        {options.map((option) => (
          <option key={option || "all"} value={option}>
            {option || "All"}
          </option>
        ))}
      </select>
    </label>
  );
}

function IssueRow({
  displayName,
  issue,
  onSelect,
  onStep,
  reviewStatus,
  selected
}: {
  displayName: string;
  issue: DriftIssue;
  onSelect: () => void;
  onStep: (step: number, row: HTMLButtonElement) => void;
  reviewStatus: ReviewStatus;
  selected: boolean;
}) {
  return (
    <button
      aria-pressed={selected}
      className="issue-row"
      data-selected={selected}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          onStep(1, event.currentTarget);
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          onStep(-1, event.currentTarget);
        }
      }}
      type="button"
    >
      <span className="issue-row__top">
        <span className="issue-row-title">{displayName}</span>
        <span className="badge-row issue-row__badges">
          <IssueBadge value={issue.severity} kind="severity" />
        </span>
      </span>
      <span className="issue-row-meta">
        {issue.routeId} · {Math.round(issue.confidence * 100)}%
      </span>
      <span className="issue-row__footer">
        <IssueBadge value={issue.category} kind="category" />
        <ReviewStatusBadge status={reviewStatus} />
      </span>
    </button>
  );
}
