import { describe, expect, it } from "vitest";
import { buildUnifiedDiff } from "./diff";

describe("buildUnifiedDiff", () => {
  it("marks added and removed lines", () => {
    const lines = buildUnifiedDiff("a\nold\nb", "a\nnew\nb");
    expect(lines.some((line) => line.type === "remove" && line.content === "old")).toBe(true);
    expect(lines.some((line) => line.type === "add" && line.content === "new")).toBe(true);
  });
});
