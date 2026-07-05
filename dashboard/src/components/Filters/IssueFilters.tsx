import type { Issue } from "../../types/report";
import {
  emptyIssueFilters,
  filterOptionsFromIssues,
  issueFiltersToSearchParams,
  parseIssueFilters,
  sortKeys,
  type IssueFilterState
} from "../../lib/filtering/filtering";
import "./IssueFilters.css";

type IssueFiltersProps = {
  issues: Issue[];
  value?: IssueFilterState;
  onChange: (next: IssueFilterState, params: URLSearchParams) => void;
};

const labels: Record<string, string> = {
  severity: "Severity",
  category: "Category",
  property: "Property",
  route: "Route",
  state: "State",
  q: "Search",
  sort: "Sort"
};

const listUpdate = (values: string[], value: string, checked: boolean) =>
  checked ? [...values, value] : values.filter((item) => item !== value);

const filterParamKeys = ["severity", "category", "property", "route", "state", "q", "sort"];

export function filtersFromLocation(search = window.location.search) {
  return parseIssueFilters(new URLSearchParams(search));
}

export function IssueFilters({ issues, value = emptyIssueFilters(), onChange }: IssueFiltersProps) {
  const options = filterOptionsFromIssues(issues);
  const visibleOptions = {
    severities: [...new Set([...options.severities, ...value.severities])],
    categories: [...new Set([...options.categories, ...value.categories])],
    properties: [...new Set([...options.properties, ...value.properties])],
    routes: [...new Set([...options.routes, ...value.routes])],
    states: [...new Set([...options.states, ...value.states])]
  };

  const update = (next: IssueFilterState) => {
    const params = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
    filterParamKeys.forEach((key) => params.delete(key));
    issueFiltersToSearchParams(next).forEach((filterValue, key) => params.set(key, filterValue));
    onChange(next, params);
  };

  const checkboxGroup = (
    key: "severities" | "categories" | "properties" | "routes" | "states",
    paramLabel: keyof typeof labels,
    values: string[]
  ) => (
    <fieldset className="issue-filters__group">
      <legend>{labels[paramLabel]}</legend>
      <div className="issue-filters__checks">
        {values.map((option) => (
          <label key={option}>
            <input
              checked={(value[key] as string[]).includes(option)}
              type="checkbox"
              onChange={(event) =>
                update({
                  ...value,
                  [key]: listUpdate(value[key] as string[], option, event.currentTarget.checked)
                })
              }
            />
            <span>{option.replaceAll("_", " ")}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );

  return (
    <form
      className="issue-filters"
      aria-label="Issue filters"
      onSubmit={(event) => event.preventDefault()}
    >
      <label className="issue-filters__search">
        <span>{labels.q}</span>
        <input
          type="search"
          value={value.search}
          placeholder="Search findings"
          onChange={(event) => update({ ...value, search: event.currentTarget.value })}
        />
      </label>

      <label className="issue-filters__sort">
        <span>{labels.sort}</span>
        <select
          value={value.sort}
          onChange={(event) =>
            update({ ...value, sort: event.currentTarget.value as IssueFilterState["sort"] })
          }
        >
          {sortKeys.map((sortKey) => (
            <option key={sortKey} value={sortKey}>
              {sortKey}
            </option>
          ))}
        </select>
      </label>

      {checkboxGroup("severities", "severity", visibleOptions.severities)}
      {checkboxGroup("categories", "category", visibleOptions.categories)}
      {checkboxGroup("properties", "property", visibleOptions.properties)}
      {checkboxGroup("routes", "route", visibleOptions.routes)}
      {checkboxGroup("states", "state", visibleOptions.states)}
    </form>
  );
}
