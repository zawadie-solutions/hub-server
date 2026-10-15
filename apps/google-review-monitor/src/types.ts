export type ReviewStatus = "REVIEW_EXISTS" | "REVIEW_REMOVED" | "UNKNOWN";

export type CheckResult =
  | { status: "REVIEW_EXISTS" }
  | { status: "REVIEW_REMOVED" }
  | { status: "UNKNOWN"; reason: string };

/** What the Google checker needs to know about a review. */
export interface ReviewToCheck {
  id: number;
  googleReviewUrl: string;
  location: string | null;
  reviewerName: string | null;
  rating: number | null;
}

/**
 * The only thing the rest of the app knows about Google.
 * Implementations MUST NOT throw and MUST return UNKNOWN on any doubt.
 */
export interface ReviewChecker {
  checkReview(review: ReviewToCheck): Promise<CheckResult>;
  /**
   * Optional: told which reviews are about to be checked, so a queue-based source can request
   * every place up front. Must not throw; `checkReview` has to work without it.
   */
  prepare?(reviews: ReviewToCheck[]): Promise<void>;
}

/** A review task discovered in Asana. */
export interface DiscoveredReview {
  asanaTaskId: string;
  asanaTaskName: string;
  asanaTaskUrl: string;
  asanaProjectGid: string;
  location: string | null;
  month: string | null;
  /** Who the dispute task itself is assigned to in Asana. */
  assigneeName: string | null;
  /** Who the location's task is assigned to in Asana. */
  locationAssigneeName: string | null;
  reviewerName: string | null;
  rating: number | null;
  reviewText: string | null;
  googleReviewUrl: string;
}

export interface ReviewRow {
  id: number;
  asana_task_id: string;
  asana_task_name: string;
  asana_task_url: string;
  asana_project_gid: string | null;
  location: string | null;
  month: string | null;
  reviewer_name: string | null;
  rating: number | null;
  review_text: string | null;
  google_review_url: string;
  status: ReviewStatus;
  first_seen_at: Date;
  last_checked_at: Date | null;
  removed_at: Date | null;
  notification_sent: boolean;
  notification_sent_at: Date | null;
  notification_attempts: number;
  last_notification_error: string | null;
  last_error: string | null;
  monitoring_active: boolean;
  created_at: Date;
  updated_at: Date;
  /** Who the dispute task is assigned to in Asana (null if nobody). */
  assignee_name: string | null;
  /** Who the location's task is assigned to in Asana (null if nobody). */
  location_assignee_name: string | null;
}

/** The person working on a dispute: its own assignee, else whoever has the location. */
export const workedOnBy = (r: Pick<ReviewRow, "assignee_name" | "location_assignee_name">): string | null => r.assignee_name || r.location_assignee_name || null;

export interface Notifier {
  send(message: { subject: string; text: string; html: string }): Promise<void>;
}
