import { describe, expect, it, vi } from "vitest";
import fixtureReport from "../../fixtures/golden/frontend-handoff-run/report.json";
import type { DriftReport } from "../contracts/types.js";
import { runCopilot, sanitizeHistory } from "./copilot.js";
import { OpenAiClient } from "./openai-client.js";

describe("copilot", () => {
  it("returns offline guidance without an API key", async () => {
    const previous = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const response = await runCopilot(fixtureReport as DriftReport, { message: "hello" });
    expect(response.model).toBe("offline");
    expect(response.reply).toContain("OPENAI_API_KEY");
    process.env.OPENAI_API_KEY = previous;
  });

  it("sanitizes history roles and length", () => {
    expect(
      sanitizeHistory([
        { role: "user", content: " hi " },
        { role: "assistant", content: "ok" },
        { role: "system", content: "ignored" } as never,
        { role: "user", content: "" }
      ])
    ).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "ok" }
    ]);
  });

  it("calls OpenAI when configured", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "Use the primary token." } }] })
    });
    const client = new OpenAiClient({ apiKey: "test", fetchImpl });
    const response = await runCopilot(
      fixtureReport as DriftReport,
      { message: "Why token misuse?" },
      undefined,
      client
    );
    expect(response.reply).toContain("primary token");
  });
});
