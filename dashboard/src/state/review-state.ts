export type ReviewStatus = "generated" | "reviewed" | "accepted_exception" | "hidden";

const keyPrefix = "driftradar:review:";
const reviewStatuses = new Set<ReviewStatus>([
  "generated",
  "reviewed",
  "accepted_exception",
  "hidden"
]);

type ReviewStore = Record<string, ReviewStatus>;

function keyForRun(runId: string) {
  return `${keyPrefix}${runId}`;
}

function readRun(storage: Storage, runId: string): ReviewStore {
  try {
    const value = storage.getItem(keyForRun(runId));
    const parsed: unknown = value ? JSON.parse(value) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, ReviewStatus] =>
        reviewStatuses.has(entry[1])
      )
    );
  } catch {
    return {};
  }
}

function writeRun(storage: Storage, runId: string, state: ReviewStore) {
  storage.setItem(keyForRun(runId), JSON.stringify(state));
}

export function getIssueReviewStatus(
  storage: Storage,
  runId: string,
  issueId: string
): ReviewStatus {
  return readRun(storage, runId)[issueId] ?? "generated";
}

export function setIssueReviewStatus(
  storage: Storage,
  runId: string,
  issueId: string,
  status: ReviewStatus
) {
  const state = readRun(storage, runId);
  if (status === "generated") {
    delete state[issueId];
  } else {
    state[issueId] = status;
  }
  writeRun(storage, runId, state);
}

export function resetIssueReviewStatus(storage: Storage, runId: string, issueId: string) {
  setIssueReviewStatus(storage, runId, issueId, "generated");
}

export function getRunReviewState(storage: Storage, runId: string): ReviewStore {
  return readRun(storage, runId);
}
