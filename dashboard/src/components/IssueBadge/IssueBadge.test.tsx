import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IssueBadge } from "./IssueBadge";

describe("IssueBadge", () => {
  it("labels severity and category without relying on color alone", () => {
    render(
      <>
        <IssueBadge value="critical" kind="severity" />
        <IssueBadge value="accidental_regression" kind="category" />
      </>
    );

    expect(screen.getByText(/Severity: Critical/i)).toBeInTheDocument();
    expect(screen.getByText(/Category: Regression/i)).toBeInTheDocument();
  });
});
