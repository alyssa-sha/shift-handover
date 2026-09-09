import { formatDateTime } from "@/lib/shifts";
import type { HandoverReview } from "@/lib/types/database";

export type ReviewRow = Pick<
  HandoverReview,
  "id" | "decision" | "feedback" | "created_at" | "reviewer_id"
>;

/**
 * Every round of review feedback, oldest first (FR-7.5).
 *
 * `handover_reviews` is append-only - there is no update or delete policy - so
 * a handover revised twice shows both rounds here, not just the latest.
 */
export function ReviewHistory({
  reviews,
  nameById,
}: {
  reviews: readonly ReviewRow[];
  nameById: Map<string, string>;
}) {
  if (reviews.length === 0) return null;

  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold">Review history</h2>
      <ol className="space-y-3">
        {reviews.map((review) => (
          <li
            key={review.id}
            className={`rounded-lg border p-3 ${
              review.decision === "approved"
                ? "border-emerald-600/40 bg-emerald-500/10"
                : "border-orange-600/40 bg-orange-500/10"
            }`}
          >
            <p className="text-sm font-medium">
              {review.decision === "approved"
                ? "Approved and published"
                : "Changes requested"}
            </p>
            <p className="mt-1 text-xs text-black/60 dark:text-white/60">
              {nameById.get(review.reviewer_id) ?? "A supervisor"} ·{" "}
              <time dateTime={review.created_at}>
                {formatDateTime(review.created_at)}
              </time>
            </p>
            {review.feedback ? (
              <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                {review.feedback}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
