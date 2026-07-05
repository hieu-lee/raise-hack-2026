import type { ReviewStatus } from "../../state/review-state";
import "./ReviewStatusBadge.css";

const labels: Record<ReviewStatus, string> = {
  generated: "Generated",
  reviewed: "Reviewed",
  accepted_exception: "Accepted exception",
  hidden: "Hidden locally"
};

interface ReviewStatusBadgeProps {
  status: ReviewStatus;
}

export function ReviewStatusBadge({ status }: ReviewStatusBadgeProps) {
  return (
    <span
      aria-label={`Review status: ${labels[status]}`}
      className={`review-status-badge review-status-badge--${status.replace(/_/g, "-")}`}
    >
      {labels[status]}
    </span>
  );
}
