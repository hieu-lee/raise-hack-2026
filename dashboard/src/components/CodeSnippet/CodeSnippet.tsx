import "./CodeSnippet.css";

type CodeSnippetTone = "added" | "removed";

interface CodeSnippetProps {
  code?: string;
  label: string;
  tone?: CodeSnippetTone;
}

const markers: Record<CodeSnippetTone, string> = {
  added: "+",
  removed: "-"
};

export function CodeSnippet({ code, label, tone }: CodeSnippetProps) {
  if (!code) {
    return (
      <div className="code-snippet code-snippet--empty">
        <span className="code-snippet__label">{label}</span>
        <p>No CSS snippet provided.</p>
      </div>
    );
  }

  const lines = code.split("\n");

  return (
    <figure className={`code-snippet${tone ? ` code-snippet--${tone}` : ""}`}>
      <figcaption>{label}</figcaption>
      <pre>
        <code>
          {lines.map((line, index) => (
            <span className="code-snippet__line" data-marker={tone && markers[tone]} key={index}>
              {line}
              {index < lines.length - 1 ? "\n" : null}
            </span>
          ))}
        </code>
      </pre>
    </figure>
  );
}
