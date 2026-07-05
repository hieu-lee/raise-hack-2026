import type { Issue, IssueCategory, IssueSeverity } from "../../types/report";

export const severityOrder: IssueSeverity[] = ["critical", "high", "medium", "low"];

export const sortKeys = ["severity", "confidence", "route", "category", "title"] as const;

export type IssueSortKey = (typeof sortKeys)[number];

export type IssueFilterState = {
  severities: IssueSeverity[];
  categories: IssueCategory[];
  properties: string[];
  routes: string[];
  states: string[];
  search: string;
  sort: IssueSortKey;
};

export const emptyIssueFilters = (): IssueFilterState => ({
  severities: [],
  categories: [],
  properties: [],
  routes: [],
  states: [],
  search: "",
  sort: "severity"
});

const listParams = (params: URLSearchParams, key: string) =>
  params
    .getAll(key)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);

export const parseIssueFilters = (params: URLSearchParams): IssueFilterState => {
  const sort = params.get("sort") ?? "";

  return {
    severities: listParams(params, "severity") as IssueSeverity[],
    categories: listParams(params, "category") as IssueCategory[],
    properties: listParams(params, "property"),
    routes: listParams(params, "route"),
    states: listParams(params, "state"),
    search: params.get("q")?.trim() ?? "",
    sort: sortKeys.includes(sort as IssueSortKey) ? (sort as IssueSortKey) : "severity"
  };
};

export const issueFiltersToSearchParams = (filters: IssueFilterState) => {
  const params = new URLSearchParams();
  const sortList = (key: string, values: string[]) =>
    [...new Set(values)].sort((a, b) => {
      if (key === "severity") {
        const severityA = severityOrder.indexOf(a as IssueSeverity);
        const severityB = severityOrder.indexOf(b as IssueSeverity);
        return (
          (severityA === -1 ? 99 : severityA) - (severityB === -1 ? 99 : severityB) || byText(a, b)
        );
      }
      return byText(a, b);
    });
  const setList = (key: string, values: string[]) => {
    if (values.length) params.set(key, sortList(key, values).join(","));
  };

  setList("severity", filters.severities);
  setList("category", filters.categories);
  setList("property", filters.properties);
  setList("route", filters.routes);
  setList("state", filters.states);
  if (filters.search.trim()) params.set("q", filters.search.trim());
  if (filters.sort !== "severity") params.set("sort", filters.sort);

  return params;
};

const hasSelectedValue = (selected: string[], value: string) =>
  selected.length === 0 || selected.includes(value);

const searchableIssueText = (issue: Issue) =>
  [
    issue.id,
    issue.title,
    issue.category,
    issue.severity,
    issue.property,
    issue.routeId,
    issue.state,
    issue.selectorHint,
    issue.observedValue,
    issue.expectedValue,
    issue.nearestToken,
    issue.reasoning,
    issue.suggestedFix?.humanInstruction
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

export const issueMatchesFilters = (issue: Issue, filters: IssueFilterState) => {
  const search = filters.search.trim().toLowerCase();

  return (
    hasSelectedValue(filters.severities, issue.severity) &&
    hasSelectedValue(filters.categories, issue.category) &&
    hasSelectedValue(filters.properties, issue.property) &&
    hasSelectedValue(filters.routes, issue.routeId) &&
    hasSelectedValue(filters.states, issue.state) &&
    (!search || searchableIssueText(issue).includes(search))
  );
};

const byText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });

export const sortIssues = (issues: Issue[], sort: IssueSortKey) =>
  [...issues].sort((a, b) => {
    const severityTie =
      severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity) ||
      b.confidence - a.confidence;

    if (sort === "severity") return severityTie || byText(a.title, b.title) || byText(a.id, b.id);
    if (sort === "confidence") {
      return (
        b.confidence - a.confidence || severityTie || byText(a.title, b.title) || byText(a.id, b.id)
      );
    }
    if (sort === "route") return byText(a.routeId, b.routeId) || severityTie || byText(a.id, b.id);
    if (sort === "category")
      return byText(a.category, b.category) || severityTie || byText(a.id, b.id);
    return byText(a.title, b.title) || severityTie || byText(a.id, b.id);
  });

export const filterIssues = (issues: Issue[], filters: IssueFilterState) =>
  sortIssues(
    issues.filter((issue) => issueMatchesFilters(issue, filters)),
    filters.sort
  );

export const filterOptionsFromIssues = (issues: Issue[]) => {
  const values = (pick: (issue: Issue) => string) =>
    [...new Set(issues.map(pick).filter(Boolean))].sort(byText);

  return {
    severities: severityOrder.filter((severity) =>
      issues.some((issue) => issue.severity === severity)
    ),
    categories: values((issue) => issue.category) as IssueCategory[],
    properties: values((issue) => issue.property),
    routes: values((issue) => issue.routeId),
    states: values((issue) => issue.state)
  };
};
