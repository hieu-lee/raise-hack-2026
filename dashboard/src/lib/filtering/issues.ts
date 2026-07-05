import type { DriftIssue, IssueCategory, IssueSeverity } from "../../types/report";
import {
  filterOptionsFromIssues,
  issueMatchesFilters,
  sortIssues as sortIssueState,
  type IssueSortKey
} from "./filtering";

export type IssueSort = IssueSortKey;

export interface IssueFilters {
  severity?: IssueSeverity | "all";
  category?: IssueCategory | "all";
  property?: string;
  route?: string;
  state?: string;
  query?: string;
}

export function uniqueIssueValues(issues: DriftIssue[], key: keyof DriftIssue): string[] {
  const options = filterOptionsFromIssues(issues);
  if (key === "category") return options.categories;
  if (key === "property") return options.properties;
  if (key === "routeId") return options.routes;
  if (key === "severity") return options.severities;
  if (key === "state") return options.states;
  return [...new Set(issues.map((issue) => String(issue[key] ?? "")).filter(Boolean))].sort();
}

export function filterIssues(issues: DriftIssue[], filters: IssueFilters): DriftIssue[] {
  return issues.filter((issue) =>
    issueMatchesFilters(issue, {
      severities: filters.severity && filters.severity !== "all" ? [filters.severity] : [],
      categories: filters.category && filters.category !== "all" ? [filters.category] : [],
      properties: filters.property ? [filters.property] : [],
      routes: filters.route ? [filters.route] : [],
      states: filters.state ? [filters.state] : [],
      search: filters.query ?? "",
      sort: "severity"
    })
  );
}

export function sortIssues(issues: DriftIssue[], sort: IssueSort): DriftIssue[] {
  return sortIssueState(issues, sort);
}
