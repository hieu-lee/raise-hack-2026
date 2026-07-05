function dashboardHeaders(mutationToken?: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    "X-DriftRadar-Client": "dashboard",
    ...(mutationToken ? { "X-DriftRadar-Token": mutationToken } : {})
  };
}

export type IssueNameMap = Record<string, string>;

export interface StylePropagationOpportunity {
  component: string;
  currentEvidence: string;
  recommendedChange: string;
  targetFiles: string[];
  confidence: number;
  rationale: string;
}

export interface StylePropagationPlan {
  status:
    | "ready"
    | "no_git"
    | "no_recent_style_change"
    | "ai_unavailable"
    | "error";
  baseRef: string;
  headRef: string;
  generatedAt: string;
  source: "openai" | "deterministic";
  theme: string;
  summary: string;
  evidence: string[];
  opportunities: StylePropagationOpportunity[];
  nextActions: string[];
  model?: string;
  error?: string;
}

export type ProjectReadiness =
  | {
      state: "ready";
      projectRoot: string;
      repoRoot: string;
      message: string;
      remote?: string;
      forked?: boolean;
    }
  | {
      state: "needs_git_init";
      projectRoot: string;
      message: string;
    }
  | {
      state: "needs_remote";
      projectRoot: string;
      repoRoot: string;
      command: string;
      message: string;
    }
  | {
      state: "needs_initial_commit";
      projectRoot: string;
      repoRoot: string;
      remote: string;
      message: string;
    }
  | {
      state: "no_source";
      message: string;
    }
  | {
      state: "error";
      message: string;
    };

export async function fetchIssueNames(
  apiBaseUrl: string,
  runId: string,
  mutationToken?: string,
  fetcher: typeof fetch = fetch
): Promise<IssueNameMap> {
  const response = await fetcher(
    `${trimTrailingSlash(apiBaseUrl)}/api/runs/${encodeURIComponent(runId)}/issue-names`,
    { headers: dashboardHeaders(mutationToken) }
  );
  if (!response.ok) {
    throw new Error("Could not load issue names.");
  }
  const payload = (await response.json()) as { names?: IssueNameMap };
  return payload.names ?? {};
}

export async function fetchStylePropagationPlan(
  apiBaseUrl: string,
  runId: string,
  mutationToken?: string,
  fetcher: typeof fetch = fetch
): Promise<StylePropagationPlan> {
  const response = await fetcher(
    `${trimTrailingSlash(apiBaseUrl)}/api/runs/${encodeURIComponent(runId)}/style-propagation`,
    { headers: dashboardHeaders(mutationToken) }
  );
  const payload = (await response.json()) as StylePropagationPlan;
  if (!response.ok) {
    return {
      status: "error",
      baseRef: "master",
      headRef: "HEAD",
      generatedAt: new Date().toISOString(),
      source: "deterministic",
      theme: "Style propagation unavailable",
      summary: payload.error ?? "Style propagation unavailable.",
      evidence: [],
      opportunities: [],
      nextActions: ["Check the local API and OpenAI configuration."],
      error: payload.error
    };
  }
  return payload;
}

export async function applyIssueFix(
  apiBaseUrl: string,
  runId: string,
  issueId: string,
  mutationToken?: string,
  fetcher: typeof fetch = fetch
): Promise<{ ok: boolean; error?: string }> {
  const response = await fetcher(
    `${trimTrailingSlash(apiBaseUrl)}/api/runs/${encodeURIComponent(runId)}/issues/${encodeURIComponent(issueId)}/apply`,
    { method: "POST", headers: dashboardHeaders(mutationToken) }
  );
  const payload = (await response.json()) as { ok?: boolean; error?: string };
  if (!response.ok) {
    return { ok: false, error: payload.error ?? "Apply failed." };
  }
  return { ok: payload.ok ?? true };
}

export async function applyAllFixes(
  apiBaseUrl: string,
  runId: string,
  issueIds?: string[],
  mutationToken?: string,
  fetcher: typeof fetch = fetch
): Promise<{ applied: number; skipped: { issueId: string; error: string }[] }> {
  const response = await fetcher(
    `${trimTrailingSlash(apiBaseUrl)}/api/runs/${encodeURIComponent(runId)}/issues/apply-all`,
    {
      method: "POST",
      headers: dashboardHeaders(mutationToken),
      body: JSON.stringify(issueIds?.length ? { issueIds } : {})
    }
  );
  const payload = (await response.json()) as {
    applied?: { issueId?: string }[];
    skipped?: { issueId: string; error: string }[];
  };
  if (!response.ok) {
    throw new Error("Apply all failed.");
  }
  return {
    applied: payload.applied?.length ?? 0,
    skipped: payload.skipped ?? []
  };
}

export async function createPullRequest(
  apiBaseUrl: string,
  runId: string,
  mutationToken?: string,
  fetcher: typeof fetch = fetch
): Promise<{ ok: boolean; prUrl?: string; error?: string; draft?: { title: string; body: string } }> {
  const response = await fetcher(
    `${trimTrailingSlash(apiBaseUrl)}/api/runs/${encodeURIComponent(runId)}/create-pr`,
    { method: "POST", headers: dashboardHeaders(mutationToken), body: "{}" }
  );
  const payload = (await response.json()) as {
    ok?: boolean;
    prUrl?: string;
    error?: string;
    draft?: { title: string; body: string };
  };
  return {
    ok: payload.ok ?? response.ok,
    prUrl: payload.prUrl,
    error: payload.error,
    draft: payload.draft
  };
}

export async function fetchProjectReadiness(
  apiBaseUrl: string,
  runId: string,
  mutationToken?: string,
  fetcher: typeof fetch = fetch
): Promise<ProjectReadiness> {
  const response = await fetcher(
    `${trimTrailingSlash(apiBaseUrl)}/api/runs/${encodeURIComponent(runId)}/project-readiness`,
    { headers: dashboardHeaders(mutationToken) }
  );
  return readProjectReadiness(response);
}

export async function prepareProjectForPullRequests(
  apiBaseUrl: string,
  runId: string,
  mutationToken?: string,
  fetcher: typeof fetch = fetch
): Promise<ProjectReadiness> {
  const response = await fetcher(
    `${trimTrailingSlash(apiBaseUrl)}/api/runs/${encodeURIComponent(runId)}/project-readiness/prepare`,
    { method: "POST", headers: dashboardHeaders(mutationToken), body: "{}" }
  );
  return readProjectReadiness(response);
}

export async function finishProjectInit(
  apiBaseUrl: string,
  runId: string,
  mutationToken?: string,
  fetcher: typeof fetch = fetch
): Promise<ProjectReadiness> {
  const response = await fetcher(
    `${trimTrailingSlash(apiBaseUrl)}/api/runs/${encodeURIComponent(runId)}/project-readiness/finish-init`,
    { method: "POST", headers: dashboardHeaders(mutationToken), body: "{}" }
  );
  return readProjectReadiness(response);
}

async function readProjectReadiness(response: Response): Promise<ProjectReadiness> {
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    return {
      state: "error",
      message: typeof payload.message === "string" ? payload.message : "Project readiness failed."
    };
  }

  if (payload.state === "ready" && isString(payload.projectRoot) && isString(payload.repoRoot)) {
    return {
      state: "ready",
      projectRoot: payload.projectRoot,
      repoRoot: payload.repoRoot,
      message: stringOr(payload.message, "Project is ready for pull requests."),
      remote: isString(payload.remote) ? payload.remote : undefined,
      forked: typeof payload.forked === "boolean" ? payload.forked : undefined
    };
  }

  if (payload.state === "needs_git_init" && isString(payload.projectRoot)) {
    return {
      state: "needs_git_init",
      projectRoot: payload.projectRoot,
      message: stringOr(payload.message, "Project needs git init before PRs.")
    };
  }

  if (
    payload.state === "needs_remote" &&
    isString(payload.projectRoot) &&
    isString(payload.repoRoot) &&
    isString(payload.command)
  ) {
    return {
      state: "needs_remote",
      projectRoot: payload.projectRoot,
      repoRoot: payload.repoRoot,
      command: payload.command,
      message: stringOr(payload.message, "Add an origin remote, then click Finish init.")
    };
  }

  if (
    payload.state === "needs_initial_commit" &&
    isString(payload.projectRoot) &&
    isString(payload.repoRoot) &&
    isString(payload.remote)
  ) {
    return {
      state: "needs_initial_commit",
      projectRoot: payload.projectRoot,
      repoRoot: payload.repoRoot,
      remote: payload.remote,
      message: stringOr(
        payload.message,
        "Remote is set. Finish init to create and push the initial commit."
      )
    };
  }

  if (payload.state === "no_source") {
    return {
      state: "no_source",
      message: stringOr(payload.message, "No repo-aware source file is attached to this run yet.")
    };
  }

  return { state: "error", message: "Project readiness unavailable." };
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
