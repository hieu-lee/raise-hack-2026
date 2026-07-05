import { Check, EyeOff, RotateCcw, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { ReviewStatusBadge } from "../ReviewStatusBadge";
import {
  getIssueReviewStatus,
  resetIssueReviewStatus,
  setIssueReviewStatus,
  type ReviewStatus
} from "../../state/review-state";
import "./ReviewActions.css";

interface ReviewActionsProps {
  runId: string;
  issueId: string;
  storage?: Storage;
  onStatusChange?: (status: ReviewStatus) => void;
}

export function ReviewActions({
  runId,
  issueId,
  storage = localStorage,
  onStatusChange
}: ReviewActionsProps) {
  const [status, setStatus] = useState<ReviewStatus>(() =>
    getIssueReviewStatus(storage, runId, issueId)
  );

  useEffect(() => {
    setStatus(getIssueReviewStatus(storage, runId, issueId));
  }, [issueId, runId, storage]);

  function update(next: ReviewStatus) {
    if (next === "generated") {
      resetIssueReviewStatus(storage, runId, issueId);
    } else {
      setIssueReviewStatus(storage, runId, issueId, next);
    }
    setStatus(next);
    onStatusChange?.(next);
  }

  return (
    <section aria-label="Review actions" className="review-actions">
      <ReviewStatusBadge status={status} />
      <div className="review-actions__buttons">
        <button
          onClick={() => update("reviewed")}
          type="button"
          title="Mark reviewed"
          aria-label="Mark reviewed"
        >
          <Check size={15} aria-hidden />
        </button>
        <button
          onClick={() => update("accepted_exception")}
          type="button"
          title="Accept exception"
          aria-label="Accept exception"
        >
          <ShieldCheck size={15} aria-hidden />
        </button>
        <button onClick={() => update("hidden")} type="button" title="Hide locally" aria-label="Hide locally">
          <EyeOff size={15} aria-hidden />
        </button>
        <button
          onClick={() => update("generated")}
          type="button"
          title="Reset issue state"
          aria-label="Reset issue state"
        >
          <RotateCcw size={15} aria-hidden />
        </button>
      </div>
    </section>
  );
}
