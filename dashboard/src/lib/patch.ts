import type { SuggestedFix } from "../types/report";

const markupExtensions = new Set([".html", ".tsx", ".jsx", ".vue"]);

export function patchPreviewForFix(
  fix: SuggestedFix | undefined
): { before: string; after: string } | undefined {
  if (!fix) {
    return undefined;
  }

  const extension = fix.sourceFile ? fileExtension(fix.sourceFile) : "";
  const markup =
    fix.tsxBefore && fix.tsxAfter ? { before: fix.tsxBefore, after: fix.tsxAfter } : undefined;
  const css =
    fix.cssBefore && fix.cssAfter ? { before: fix.cssBefore, after: fix.cssAfter } : undefined;

  if (markupExtensions.has(extension)) {
    return markup ?? css;
  }

  return css ?? markup;
}

function fileExtension(filePath: string): string {
  const base = filePath.split(/[/\\]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot) : "";
}
