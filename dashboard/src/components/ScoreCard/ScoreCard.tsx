import "./ScoreCard.css";

type ScoreCardProps = {
  label: string;
  value: string | number;
  detail?: string;
  tone?: "neutral" | "critical" | "high" | "medium" | "low" | "good";
};

export function ScoreCard({ label, value, detail, tone = "neutral" }: ScoreCardProps) {
  return (
    <article className={`score-card score-card--${tone}`}>
      <p className="score-card__label">{label}</p>
      <strong className="score-card__value">{value}</strong>
      {detail ? <p className="score-card__detail">{detail}</p> : null}
    </article>
  );
}
