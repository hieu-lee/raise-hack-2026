import { describe, expect, it } from "vitest";
import { patchPreviewForFix } from "./patch";

describe("patchPreviewForFix", () => {
  it("prefers css snippets for css files", () => {
    const preview = patchPreviewForFix({
      type: "replace_with_token",
      sourceFile: "/repo/styles.css",
      cssBefore: "color: red;",
      cssAfter: "color: blue;",
      tsxBefore: "className='x'",
      tsxAfter: "className='y'",
      humanInstruction: "fix"
    });

    expect(preview).toEqual({ before: "color: red;", after: "color: blue;" });
  });

  it("prefers markup snippets for tsx files", () => {
    const preview = patchPreviewForFix({
      type: "promote_pattern",
      sourceFile: "/repo/Card.tsx",
      cssBefore: "gap: 8px;",
      cssAfter: "gap: var(--gap);",
      tsxBefore: 'className="gap-2"',
      tsxAfter: 'className="gap-token"',
      humanInstruction: "fix"
    });

    expect(preview).toEqual({ before: 'className="gap-2"', after: 'className="gap-token"' });
  });
});
