import { createHash } from "node:crypto";

export type ElementIdInput = {
  routeId: string;
  domPath: string;
  role?: string;
  tagName: string;
  classHint?: string;
};

export function elementIdFor(input: ElementIdInput): string {
  const key = [
    input.routeId,
    input.domPath,
    input.role ?? "",
    input.tagName.toLowerCase(),
    normalizeClassHint(input.classHint ?? "")
  ].join("|");

  return `el_${createHash("sha1").update(key).digest("hex").slice(0, 14)}`;
}

export function normalizeClassHint(className: string): string {
  const classes = className
    .split(/\s+/)
    .map((name) => name.trim())
    .filter(Boolean);

  return [...new Set(classes)].sort().slice(0, 3).join(".");
}
