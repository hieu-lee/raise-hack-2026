// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DemoCallout } from "./DemoCallout";

describe("DemoCallout", () => {
  afterEach(cleanup);

  it("renders the export callout", () => {
    render(<DemoCallout kind="export" />);

    expect(screen.getByLabelText("Export demo note").textContent).toContain("PR-ready markdown");
  });
});
