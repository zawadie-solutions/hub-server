import { logger } from "../logger";
import type { CheckResult, ReviewChecker, ReviewToCheck } from "../types";

/** How every checker words an UNKNOWN that means "the source itself failed" (see their checkReview). */
const SOURCE_FAILED = "google check failed:";

/**
 * Asks a second review source when the first one could not answer because it failed
 * (out of credit, refused, timed out, unreachable). An UNKNOWN the first source reached on
 * the merits — the review is older than its cap, the listing is incomplete, the link is
 * unusable — stands as it is: the second source would only be paid to repeat it.
 *
 * The fallback's verdict is taken whole, including REVIEW_REMOVED, since it applies the same
 * rules; the monitor's confirmation check then goes through this same path again.
 */
export class FallbackChecker implements ReviewChecker {
  constructor(
    private primary: ReviewChecker,
    private fallback: ReviewChecker,
    private names: { primary: string; fallback: string },
  ) {}

  /** Only the primary is prepared: the fallback is paid per use and may never be needed. */
  async prepare(reviews: ReviewToCheck[]): Promise<void> {
    await this.primary.prepare?.(reviews);
  }

  async checkReview(review: ReviewToCheck): Promise<CheckResult> {
    const first = await this.primary.checkReview(review);
    if (first.status !== "UNKNOWN" || !first.reason.startsWith(SOURCE_FAILED)) return first;

    logger.info({ reviewId: review.id, location: review.location, reason: first.reason, fallback: this.names.fallback }, "primary review source failed; trying the fallback");
    const second = await this.fallback.checkReview(review);
    if (second.status !== "UNKNOWN") return second;
    return { status: "UNKNOWN", reason: `${this.names.primary}: ${first.reason}; ${this.names.fallback}: ${second.reason}` };
  }
}
