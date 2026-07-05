// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getIssueReviewStatus, setIssueReviewStatus } from "../../state/review-state";
import { ReviewActions } from "./ReviewActions";

describe("ReviewActions", () => {
  afterEach(cleanup);

  it("updates and persists local issue review status", () => {
    localStorage.clear();
    const onStatusChange = vi.fn();

    render(<ReviewActions issueId="issue-1" onStatusChange={onStatusChange} runId="run-a" />);
    expect(screen.getByLabelText("Review status: Generated")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Accept exception" }));

    expect(screen.getByLabelText("Review status: Accepted exception")).toBeTruthy();
    expect(getIssueReviewStatus(localStorage, "run-a", "issue-1")).toBe("accepted_exception");
    expect(onStatusChange).toHaveBeenCalledWith("accepted_exception");
  });

  it("loads existing status and resets it", () => {
    localStorage.clear();
    setIssueReviewStatus(localStorage, "run-a", "issue-1", "hidden");

    render(<ReviewActions issueId="issue-1" runId="run-a" />);
    expect(screen.getByLabelText("Review status: Hidden locally")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Reset issue state" }));

    expect(screen.getByLabelText("Review status: Generated")).toBeTruthy();
    expect(getIssueReviewStatus(localStorage, "run-a", "issue-1")).toBe("generated");
  });
});
