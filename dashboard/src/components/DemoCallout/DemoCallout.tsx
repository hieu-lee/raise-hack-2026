import "./DemoCallout.css";

type DemoCalloutKind = "scan" | "classify" | "suggest" | "export";

const copy: Record<DemoCalloutKind, { title: string; body: string }> = {
  scan: {
    title: "Scan",
    body: "Local captures compare rendered UI against committed design tokens."
  },
  classify: {
    title: "Classify",
    body: "Findings are grouped as token misuse, new pattern, regression, or accepted exception."
  },
  suggest: {
    title: "Suggest",
    body: "Each issue keeps the reasoning beside the concrete token or CSS reconciliation."
  },
  export: {
    title: "Export",
    body: "The report turns review decisions into PR-ready markdown without mutating backend data."
  }
};

interface DemoCalloutProps {
  kind: DemoCalloutKind;
}

export function DemoCallout({ kind }: DemoCalloutProps) {
  const item = copy[kind];

  return (
    <aside aria-label={`${item.title} demo note`} className="demo-callout">
      <strong>{item.title}</strong>
      <p>{item.body}</p>
    </aside>
  );
}
