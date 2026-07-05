import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CopilotPanel } from "./CopilotPanel";

describe("CopilotPanel", () => {
  it("posts copilot messages to the local API", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ reply: "Use the primary token.", model: "gpt-5.4-mini" })
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(
      <CopilotPanel
        apiBaseUrl="http://localhost:4317"
        enabled
        issue={{ id: "issue-1", title: "Color drift" } as never}
        runId="demo-run"
      />
    );

    await user.click(screen.getByRole("button", { name: /Open copilot/i }));
    await user.type(screen.getByLabelText(/Copilot message/i), "Why token misuse?");
    await user.click(screen.getByRole("button", { name: /Send message/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:4317/api/runs/demo-run/copilot");
    expect(await screen.findByText(/Use the primary token/i)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
