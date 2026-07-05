import { useEffect, useState } from "react";
import { fetchIssueNames, type IssueNameMap } from "../api/mutations";
import type { DriftIssue } from "../types/report";

export function useIssueNames(
  apiBaseUrl: string | undefined,
  runId: string,
  issues: DriftIssue[],
  enabled: boolean,
  mutationToken?: string
): IssueNameMap {
  const [names, setNames] = useState<IssueNameMap>({});

  useEffect(() => {
    if (!enabled || !apiBaseUrl) {
      setNames(Object.fromEntries(issues.map((issue) => [issue.id, issue.title])));
      return;
    }

    let cancelled = false;
    fetchIssueNames(apiBaseUrl, runId, mutationToken)
      .then((next) => {
        if (!cancelled) {
          setNames(next);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setNames(Object.fromEntries(issues.map((issue) => [issue.id, issue.title])));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, enabled, issues, mutationToken, runId]);

  return names;
}

export function issueLabel(issue: DriftIssue | undefined, names: IssueNameMap): string {
  if (!issue) {
    return "Issue";
  }
  return names[issue.id] ?? issue.title;
}
