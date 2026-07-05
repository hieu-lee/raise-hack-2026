import { useState } from "react";

type CopyState = "idle" | "copied" | "failed";

interface CopyButtonProps {
  getText: () => string;
  label?: string;
  copiedLabel?: string;
  failedLabel?: string;
  className?: string;
}

export function CopyButton({
  getText,
  label = "Copy",
  copiedLabel = "Copied",
  failedLabel = "Copy failed",
  className
}: CopyButtonProps) {
  const [state, setState] = useState<CopyState>("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(getText());
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  const text = state === "copied" ? copiedLabel : state === "failed" ? failedLabel : label;

  return (
    <button className={className} onClick={copy} type="button">
      {text}
    </button>
  );
}
