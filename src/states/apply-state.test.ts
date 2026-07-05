import { describe, expect, it, vi } from "vitest";
import { applyCaptureState } from "./apply-state.js";

describe("applyCaptureState", () => {
  it("sets deterministic light media for the default state", async () => {
    const page = fakePage();

    await applyCaptureState(page as never, "default");

    expect(page.emulateMedia).toHaveBeenCalledWith({
      colorScheme: "light",
      reducedMotion: "reduce"
    });
    expect(page.locator).not.toHaveBeenCalled();
    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it("uses deterministic media settings for dark mode", async () => {
    const page = {
      emulateMedia: vi.fn(),
      evaluate: vi.fn()
    };

    await applyCaptureState(page as never, "dark");

    expect(page.emulateMedia).toHaveBeenCalledWith({
      colorScheme: "dark",
      reducedMotion: "reduce"
    });
    expect(page.evaluate).toHaveBeenCalledOnce();
    const html = {
      classList: { add: vi.fn() },
      setAttribute: vi.fn()
    };
    vi.stubGlobal("document", { documentElement: html });
    page.evaluate.mock.calls[0]?.[0]();
    expect(html.classList.add).toHaveBeenCalledWith("dark");
    expect(html.setAttribute).toHaveBeenCalledWith("data-theme", "dark");
  });

  it("hovers the first state target", async () => {
    const hover = vi.fn().mockResolvedValue(undefined);
    const page = fakePage({ hover });

    await applyCaptureState(page as never, "hover");

    expect(page.emulateMedia).toHaveBeenCalledWith({
      colorScheme: "light",
      reducedMotion: "reduce"
    });
    expect(hover).toHaveBeenCalledWith({ trial: false });
  });

  it("focuses the first state target", async () => {
    const focus = vi.fn().mockResolvedValue(undefined);
    const page = fakePage({ focus });

    await applyCaptureState(page as never, "focus");

    expect(page.emulateMedia).toHaveBeenCalledWith({
      colorScheme: "light",
      reducedMotion: "reduce"
    });
    expect(focus).toHaveBeenCalledOnce();
  });

  it("marks the first state target disabled in page context", async () => {
    const page = fakePage();

    await applyCaptureState(page as never, "disabled");

    expect(page.emulateMedia).toHaveBeenCalledWith({
      colorScheme: "light",
      reducedMotion: "reduce"
    });
    expect(page.evaluate).toHaveBeenCalledOnce();
    expect(page.evaluate.mock.calls[0]?.[1]).toContain("button:not([disabled])");
    expect(page.evaluate.mock.calls[0]?.[1]).toContain("summary");
    expect(page.evaluate.mock.calls[0]?.[1]).toContain("[tabindex]:not([tabindex='-1'])");
  });
});

function fakePage(
  actions: { hover?: ReturnType<typeof vi.fn>; focus?: ReturnType<typeof vi.fn> } = {}
) {
  const first = vi.fn(() => ({
    hover: actions.hover ?? vi.fn().mockResolvedValue(undefined),
    focus: actions.focus ?? vi.fn().mockResolvedValue(undefined)
  }));

  return {
    emulateMedia: vi.fn(),
    evaluate: vi.fn().mockResolvedValue(undefined),
    locator: vi.fn(() => ({ first }))
  };
}
