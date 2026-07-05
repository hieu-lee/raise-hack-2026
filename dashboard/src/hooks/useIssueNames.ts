import { useEffect, useMemo, useState } from "react";
import { fetchIssueNames, type IssueNameMap } from "../api/mutations";
import type { DriftIssue } from "../types/report";

export function useIssueNames(
  apiBaseUrl: string | undefined,
  runId: string,
  issues: DriftIssue[],
  enabled: boolean,
  mutationToken?: string
): IssueNameMap {
  const fallbackNames = useMemo(
    () => Object.fromEntries(issues.map((issue) => [issue.id, issue.title])),
    [issues]
  );
  const [names, setNames] = useState<IssueNameMap>(fallbackNames);

  useEffect(() => {
    if (!enabled || !apiBaseUrl) {
      setNames(fallbackNames);
      return;
    }

    let cancelled = false;
    fetchIssueNames(apiBaseUrl, runId, mutationToken)
      .then((next) => {
        if (!cancelled) {
          setNames({ ...fallbackNames, ...next });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setNames(fallbackNames);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, enabled, fallbackNames, mutationToken, runId]);

  return names;
}

export function issueLabel(issue: DriftIssue | undefined, names: IssueNameMap): string {
  if (!issue) {
    return "Issue";
  }
  return names[issue.id] ?? issue.title;
}
