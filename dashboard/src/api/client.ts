import type { DriftReport } from "../types/report";

export const DEFAULT_API_BASE_URL = "http://localhost:4317";
export const FIXTURE_ROOT = "/fixtures/frontend-handoff-run";

export type ConnectionMode = "live" | "fixture" | "no-runs" | "disconnected";

export interface RunSummary {
  runId: string;
  createdAt?: string;
  reportPath?: string;
}

export interface DashboardConnection {
  mode: ConnectionMode;
  apiBaseUrl: string;
  runId?: string;
  message?: string;
  mutationToken?: string;
}

export interface DashboardData {
  connection: DashboardConnection;
  report?: DriftReport;
}

export interface LoadDashboardOptions {
  apiBaseUrl?: string;
  runId?: string;
  fixtureOnly?: boolean;
  fetcher?: typeof fetch;
}

export async function loadDashboardData(
  options: LoadDashboardOptions = {}
): Promise<DashboardData> {
  const apiBaseUrl = trimTrailingSlash(options.apiBaseUrl ?? DEFAULT_API_BASE_URL);
  const fetcher = options.fetcher ?? fetch;

  if (options.fixtureOnly) {
    return loadFixtureData(apiBaseUrl, fetcher);
  }

  try {
    var health = await fetchJson<{ mutationToken?: string }>(`${apiBaseUrl}/api/health`, fetcher);
  } catch {
    return loadFixtureData(apiBaseUrl, fetcher);
  }

  try {
    const runsResponse = await fetchJson<{ runs?: RunSummary[] }>(
      `${apiBaseUrl}/api/runs`,
      fetcher
    );
    const runs = runsResponse.runs ?? [];
    const runId = options.runId ?? newestRun(runs)?.runId;

    if (!runId) {
      return {
        connection: {
          mode: "no-runs",
          apiBaseUrl,
          message: "Live API is available, but no scan runs were found."
        }
      };
    }

    return {
      connection: { mode: "live", apiBaseUrl, runId, mutationToken: health.mutationToken },
      report: await fetchJson<DriftReport>(
        `${apiBaseUrl}/api/runs/${encodeURIComponent(runId)}/report`,
        fetcher
      )
    };
  } catch {
    return {
      connection: {
        mode: "disconnected",
        apiBaseUrl,
        message: "Live API responded, but the selected run report could not be loaded."
      }
    };
  }
}

export async function loadFixtureData(
  apiBaseUrl = DEFAULT_API_BASE_URL,
  fetcher: typeof fetch = fetch
): Promise<DashboardData> {
  try {
    return {
      connection: {
        mode: "fixture",
        apiBaseUrl: trimTrailingSlash(apiBaseUrl),
        runId: "frontend-handoff-run",
        message: "Live API unavailable; showing committed fixture data."
      },
      report: await fetchJson<DriftReport>(`${FIXTURE_ROOT}/report.json`, fetcher)
    };
  } catch {
    return {
      connection: {
        mode: "disconnected",
        apiBaseUrl: trimTrailingSlash(apiBaseUrl),
        message: "No live API or fixture report could be loaded."
      }
    };
  }
}

export function assetUrlFor(
  connection: DashboardConnection,
  relativePath?: string
): string | undefined {
  const assetPath = encodeAssetPath(relativePath);
  if (!assetPath) {
    return undefined;
  }

  if (connection.mode === "live" && connection.runId) {
    return `${trimTrailingSlash(connection.apiBaseUrl)}/api/runs/${encodeURIComponent(
      connection.runId
    )}/assets/${assetPath}`;
  }

  if (connection.mode === "fixture") {
    return `${FIXTURE_ROOT}/${assetPath}`;
  }

  return undefined;
}

export async function fetchExportMarkdown(
  connection: DashboardConnection,
  fetcher: typeof fetch = fetch,
  report?: DriftReport
): Promise<string> {
  try {
    if (connection.mode === "live" && connection.runId) {
      return await fetchText(
        `${trimTrailingSlash(connection.apiBaseUrl)}/api/runs/${encodeURIComponent(
          connection.runId
        )}/export/pr-comments`,
        fetcher
      );
    }

    if (connection.mode === "fixture") {
      return await fetchText(`${FIXTURE_ROOT}/pr-comments.md`, fetcher);
    }
  } catch (error) {
    if (!report) {
      throw error;
    }
  }

  if (report) {
    return markdownFromReport(report);
  }

  throw new Error("Export markdown is unavailable without a report.");
}

export function runIdFromSearch(search: string): string | undefined {
  return new URLSearchParams(search).get("runId") || undefined;
}

function newestRun(runs: RunSummary[]): RunSummary | undefined {
  return [...runs].sort((left, right) =>
    String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? ""))
  )[0];
}

async function fetchJson<T>(url: string, fetcher: typeof fetch): Promise<T> {
  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${url}`);
  }
  return (await response.json()) as T;
}

async function fetchText(url: string, fetcher: typeof fetch): Promise<string> {
  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${url}`);
  }
  return response.text();
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function encodeAssetPath(relativePath?: string): string | undefined {
  return relativePath
    ?.split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function markdownFromReport(report: DriftReport): string {
  const lines = [
    `# DriftRadar findings for ${report.projectName}`,
    "",
    `Run: ${report.runId}`,
    `Drift score: ${report.summary.driftScore}`,
    ""
  ];

  if (report.issues.length === 0) {
    lines.push("No design-system drift issues were found.");
    return lines.join("\n");
  }

  for (const issue of report.issues) {
    lines.push(
      `## ${issue.title}`,
      "",
      `- Severity: ${issue.severity}`,
      `- Category: ${issue.category}`,
      `- Route: ${issue.routeId}`,
      `- Reasoning: ${issue.reasoning}`,
      `- Suggested fix: ${issue.suggestedFix?.humanInstruction ?? "No suggested fix provided."}`,
      ""
    );
  }

  return lines.join("\n");
}
