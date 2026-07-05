import { buildUnifiedDiff } from "../../lib/diff";
import "./UnifiedDiff.css";

interface UnifiedDiffProps {
  before?: string;
  after?: string;
  filePath?: string;
}

export function UnifiedDiff({ before = "", after = "", filePath }: UnifiedDiffProps) {
  if (!before && !after) {
    return <p className="unified-diff__empty">No patch available.</p>;
  }

  const lines = buildUnifiedDiff(before, after);

  return (
    <section className="unified-diff" aria-label="Suggested patch diff">
      {filePath ? (
        <header className="unified-diff__header">
          <code>{filePath}</code>
        </header>
      ) : null}
      <pre className="unified-diff__body" tabIndex={0}>
        <code>
          {lines.map((line, index) => (
            <div
              className={`unified-diff__line unified-diff__line--${line.type}`}
              key={`${line.type}-${index}`}
            >
              <span className="unified-diff__gutter">
                {line.oldLine ?? ""}
                {line.oldLine && line.newLine ? " " : ""}
                {line.newLine ?? ""}
              </span>
              <span className="unified-diff__marker">
                {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
              </span>
              <span className="unified-diff__content">{line.content || " "}</span>
            </div>
          ))}
        </code>
      </pre>
    </section>
  );
}
