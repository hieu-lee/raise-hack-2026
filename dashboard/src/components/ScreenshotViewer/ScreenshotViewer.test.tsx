import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScreenshotViewer } from "./ScreenshotViewer";

describe("ScreenshotViewer", () => {
  it("renders a crop overlay when evidence includes a crop box", () => {
    render(
      <ScreenshotViewer
        alt="Button evidence"
        src="/fixtures/frontend-handoff-run/screenshots/buttons/desktop/default.png"
        cropBox={{ x: 32, y: 96, width: 156, height: 44 }}
      />
    );

    expect(screen.getByAltText("Button evidence")).toBeInTheDocument();
    expect(screen.getByLabelText("Highlighted issue crop")).toHaveStyle({
      left: "32px",
      top: "96px",
      width: "156px",
      height: "44px"
    });
  });

  it("shows a designed placeholder when the screenshot is missing", () => {
    render(<ScreenshotViewer alt="Missing evidence" />);

    expect(screen.getByRole("img", { name: "Screenshot unavailable" })).toBeInTheDocument();
  });

  it("shows a placeholder after image load failure", () => {
    render(<ScreenshotViewer alt="Broken evidence" src="/missing.png" />);

    fireEvent.error(screen.getByAltText("Broken evidence"));

    expect(screen.getByRole("img", { name: "Screenshot unavailable" })).toBeInTheDocument();
  });

  it("retries rendering when the screenshot source changes", () => {
    const { rerender } = render(<ScreenshotViewer alt="Evidence" src="/missing.png" />);
    fireEvent.error(screen.getByAltText("Evidence"));

    rerender(<ScreenshotViewer alt="Evidence" src="/valid.png" />);

    expect(screen.getByAltText("Evidence")).toHaveAttribute("src", "/valid.png");
  });
});
