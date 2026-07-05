// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DEFAULT_API_BASE_URL } from "../api/client";
import { AppShell } from "./AppShell";

describe("AppShell", () => {
  it("renders navigation and the current connection badge", () => {
    render(
      <AppShell
        activeScreen="overview"
        connection={{ mode: "fixture", apiBaseUrl: DEFAULT_API_BASE_URL }}
      >
        <h1>Overview placeholder</h1>
      </AppShell>
    );

    expect(screen.getByLabelText("Dashboard")).toBeTruthy();
    expect(screen.getByText("Fixture")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Overview/i }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("heading", { name: "Overview placeholder" })).toBeTruthy();
  });
});
