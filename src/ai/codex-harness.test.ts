import { afterEach, describe, expect, it, vi } from "vitest";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { CodexHarness, codexWorkingDirectoryForSourceRoots } from "./codex-harness.js";

const mocks = vi.hoisted(() => ({
  codex: vi.fn(),
  run: vi.fn(),
  startThread: vi.fn()
}));

vi.mock("@openai/codex-sdk", () => ({
  Codex: mocks.codex
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("CodexHarness", () => {
  it("starts Codex with web search and sandbox network disabled", async () => {
    const previousPath = process.env.PATH;
    mocks.run.mockResolvedValue({ finalResponse: JSON.stringify({ ok: true }) });
    mocks.startThread.mockReturnValue({ run: mocks.run });
    mocks.codex.mockImplementation(function CodexMock() {
      return { startThread: mocks.startThread };
    });
    const projectBin = join(process.cwd(), "node_modules", ".bin");
    process.env.PATH = `${projectBin}${delimiter}${previousPath ?? ""}`;

    try {
      const harness = new CodexHarness({ workingDirectory: process.cwd() });
      await expect(harness.runJson<{ ok: boolean }>("prompt", { type: "object" })).resolves.toEqual(
        {
          ok: true
        }
      );
    } finally {
      process.env.PATH = previousPath;
    }

    expect(mocks.startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalPolicy: "never",
        networkAccessEnabled: false,
        sandboxMode: "read-only",
        webSearchEnabled: false,
        webSearchMode: "disabled"
      })
    );
    const codexOptions = mocks.codex.mock.calls[0]?.[0] as { env?: Record<string, string> };
    expect(codexOptions.env?.HOME).toContain(`${tmpdir()}/driftradar-codex-home-`);
    expect(codexOptions.env?.CODEX_HOME).toBe(codexOptions.env?.HOME);
    expect(codexOptions.env?.HOME).not.toBe(process.env.HOME);
    expect(codexOptions.env?.HOME).not.toContain(process.cwd());
    expect(codexOptions.env?.PATH?.split(delimiter)).not.toContain(projectBin);
    await rm(codexOptions.env?.HOME ?? "", { recursive: true, force: true });
  });

  it("does not widen Codex repo-patch roots to a sibling parent", () => {
    expect(
      codexWorkingDirectoryForSourceRoots(["/tmp/repo/apps/web", "/tmp/repo/packages/ui"])
    ).toBeUndefined();
    expect(codexWorkingDirectoryForSourceRoots(["/tmp/repo", "/tmp/repo/packages/ui"])).toBe(
      "/tmp/repo"
    );
  });

  it("uses an explicit project root for sibling source roots", () => {
    expect(
      codexWorkingDirectoryForSourceRoots(
        ["/tmp/repo/apps/web/src", "/tmp/repo/packages/ui/src"],
        "/tmp/repo"
      )
    ).toBe("/tmp/repo");
    expect(
      codexWorkingDirectoryForSourceRoots(
        ["/tmp/repo/apps/web/src", "/tmp/other/packages/ui/src"],
        "/tmp/repo"
      )
    ).toBeUndefined();
  });
});
