export type DiffLineType = "context" | "add" | "remove";

export interface DiffLine {
  type: DiffLineType;
  oldLine?: number;
  newLine?: number;
  content: string;
}

export function buildUnifiedDiff(before: string, after: string): DiffLine[] {
  const left = before.split("\n");
  const right = after.split("\n");
  const ops = diffLines(left, right);
  const lines: DiffLine[] = [];
  let oldLine = 1;
  let newLine = 1;

  for (const op of ops) {
    if (op.type === "equal") {
      for (const line of op.lines) {
        lines.push({ type: "context", oldLine, newLine, content: line });
        oldLine += 1;
        newLine += 1;
      }
      continue;
    }

    if (op.type === "remove") {
      for (const line of op.lines) {
        lines.push({ type: "remove", oldLine, content: line });
        oldLine += 1;
      }
      continue;
    }

    for (const line of op.lines) {
      lines.push({ type: "add", newLine, content: line });
      newLine += 1;
    }
  }

  return lines;
}

type DiffOp =
  | { type: "equal"; lines: string[] }
  | { type: "remove"; lines: string[] }
  | { type: "add"; lines: string[] };

function diffLines(left: string[], right: string[]): DiffOp[] {
  const lcs = longestCommonSubsequence(left, right);
  const ops: DiffOp[] = [];
  let leftIndex = 0;
  let rightIndex = 0;

  for (const [li, ri] of lcs) {
    if (leftIndex < li) {
      ops.push({ type: "remove", lines: left.slice(leftIndex, li) });
    }
    if (rightIndex < ri) {
      ops.push({ type: "add", lines: right.slice(rightIndex, ri) });
    }
    ops.push({ type: "equal", lines: [left[li]!] });
    leftIndex = li + 1;
    rightIndex = ri + 1;
  }

  if (leftIndex < left.length) {
    ops.push({ type: "remove", lines: left.slice(leftIndex) });
  }
  if (rightIndex < right.length) {
    ops.push({ type: "add", lines: right.slice(rightIndex) });
  }

  return ops;
}

function longestCommonSubsequence(left: string[], right: string[]): Array<[number, number]> {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const lengths = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      lengths[i]![j] =
        left[i - 1] === right[j - 1]
          ? lengths[i - 1]![j - 1]! + 1
          : Math.max(lengths[i - 1]![j]!, lengths[i]![j - 1]!);
    }
  }

  const pairs: Array<[number, number]> = [];
  let i = left.length;
  let j = right.length;
  while (i > 0 && j > 0) {
    if (left[i - 1] === right[j - 1]) {
      pairs.unshift([i - 1, j - 1]);
      i -= 1;
      j -= 1;
    } else if (lengths[i - 1]![j]! >= lengths[i]![j - 1]!) {
      i -= 1;
    } else {
      j -= 1;
    }
  }

  return pairs;
}
