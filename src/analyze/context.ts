import type { ObservationRecord } from "../contracts/types.js";

export function isContextException(record: ObservationRecord): boolean {
  const text = [record.selectorHint, record.textSample, record.role, record.tagName]
    .join(" ")
    .toLowerCase();

  return (
    /\b(external|third-party|embed|ad|logo|avatar|media)\b/.test(text) ||
    ["img", "svg", "canvas", "video"].includes(record.tagName.toLowerCase()) ||
    Number(record.computed.opacity) < 0.5
  );
}
