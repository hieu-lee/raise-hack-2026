import "./SummaryBar.css";

type SummaryBarItem = {
  label: string;
  value: number;
  tone?: "critical" | "high" | "medium" | "low" | "neutral";
};

type SummaryBarProps = {
  title: string;
  items: SummaryBarItem[];
};

export function SummaryBar({ title, items }: SummaryBarProps) {
  const total = items.reduce((sum, item) => sum + item.value, 0);

  return (
    <section className="summary-bar" aria-label={title}>
      <div className="summary-bar__header">
        <h2>{title}</h2>
        <span>{total} total</span>
      </div>
      <div className="summary-bar__rows">
        {items.map((item) => (
          <div className="summary-bar__row" key={item.label}>
            <span className="summary-bar__label">{item.label}</span>
            <div className="summary-bar__track" aria-hidden="true">
              <span
                className={`summary-bar__fill summary-bar__fill--${item.tone ?? "neutral"}`}
                style={{ width: total ? `${(item.value / total) * 100}%` : "0%" }}
              />
            </div>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}
