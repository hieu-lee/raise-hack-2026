import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CodeSnippet } from "./CodeSnippet";

describe("CodeSnippet", () => {
  it("renders code when provided", () => {
    render(<CodeSnippet label="After" code="background: var(--color-primary-600);" />);

    expect(screen.getByText("After")).toBeInTheDocument();
    expect(screen.getByText("background: var(--color-primary-600);")).toBeInTheDocument();
  });

  it("renders an empty state when omitted", () => {
    render(<CodeSnippet label="Before" />);

    expect(screen.getByText("No CSS snippet provided.")).toBeInTheDocument();
  });
});
