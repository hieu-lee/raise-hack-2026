// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  getIssueReviewStatus,
  getRunReviewState,
  resetIssueReviewStatus,
  setIssueReviewStatus
} from "./review-state";

describe("review-state", () => {
  it("stores issue status by run and issue without mutating generated report status", () => {
    localStorage.clear();

    setIssueReviewStatus(localStorage, "run-a", "issue-1", "reviewed");
    setIssueReviewStatus(localStorage, "run-b", "issue-1", "hidden");

    expect(getIssueReviewStatus(localStorage, "run-a", "issue-1")).toBe("reviewed");
    expect(getIssueReviewStatus(localStorage, "run-b", "issue-1")).toBe("hidden");
    expect(getIssueReviewStatus(localStorage, "run-a", "issue-2")).toBe("generated");
  });

  it("resets an issue back to generated state", () => {
    localStorage.clear();

    setIssueReviewStatus(localStorage, "run-a", "issue-1", "accepted_exception");
    resetIssueReviewStatus(localStorage, "run-a", "issue-1");

    expect(getIssueReviewStatus(localStorage, "run-a", "issue-1")).toBe("generated");
    expect(getRunReviewState(localStorage, "run-a")).toEqual({});
  });

  it("treats corrupted local storage as empty", () => {
    localStorage.clear();
    localStorage.setItem("driftradar:review:run-a", "not-json");

    expect(getIssueReviewStatus(localStorage, "run-a", "issue-1")).toBe("generated");
  });

  it("ignores parse-valid but invalid stored statuses", () => {
    localStorage.clear();
    localStorage.setItem(
      "driftradar:review:run-a",
      JSON.stringify({ "issue-1": "open", "issue-2": "hidden", "issue-3": null })
    );

    expect(getIssueReviewStatus(localStorage, "run-a", "issue-1")).toBe("generated");
    expect(getIssueReviewStatus(localStorage, "run-a", "issue-2")).toBe("hidden");
    expect(getIssueReviewStatus(localStorage, "run-a", "issue-3")).toBe("generated");
  });

  it("ignores non-object stored values", () => {
    localStorage.clear();
    localStorage.setItem("driftradar:review:run-a", "null");

    expect(getIssueReviewStatus(localStorage, "run-a", "issue-1")).toBe("generated");
  });
});
