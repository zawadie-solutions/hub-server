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
  /** Who the dispute task itself is assigned to in Asana, and their Asana email. */
  assigneeName: string | null;
  assigneeEmail: string | null;
  /** Who the location's task is assigned to in Asana, and their Asana email. */
  locationAssigneeName: string | null;
  locationAssigneeEmail: string | null;
  reviewerName: string | null;
  rating: number | null;
  reviewText: string | null;
  googleReviewUrl: string;
  /** Already tagged "Successfully removed" in Asana, so the team knows: never alert about it. */
  taggedRemoved: boolean;
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
  /** Their Asana emails, used to find them in Slack when the name does not match. */
  assignee_email: string | null;
  location_assignee_email: string | null;
  /** Tagged "Successfully removed" in Asana as of the last sync. */
  asana_tagged_removed: boolean;
}

/** The person working on a dispute: its own assignee, else whoever has the location. */
export const workedOnBy = (r: Pick<ReviewRow, "assignee_name" | "location_assignee_name">): string | null => r.assignee_name || r.location_assignee_name || null;

/** The same person as workedOnBy, with their Asana email when Asana gives one. */
export function workedOnByPerson(
  r: Pick<ReviewRow, "assignee_name" | "location_assignee_name" | "assignee_email" | "location_assignee_email">,
): { name: string | null; email: string | null } | null {
  if (r.assignee_name || r.assignee_email) return { name: r.assignee_name, email: r.assignee_email ?? null };
  if (r.location_assignee_name || r.location_assignee_email) return { name: r.location_assignee_name, email: r.location_assignee_email ?? null };
  return null;
}

/** What happened when one agent was sent their own removal alert. */
export interface AgentNotice {
  userId: string;
  name: string;
  reviews: number;
  error?: string;
}

export interface RemovalMessage {
  subject: string;
  text: string;
  html: string;
}

export interface Notifier {
  /** Sends every removal to the leads. Throws when it did not reach them, so it is retried. */
  send(message: RemovalMessage): Promise<void>;
  /**
   * Also tells each agent about only the removals they worked on. Optional (email has no
   * per-person routing). Never throws: each agent's outcome is reported instead.
   */
  notifyAgents?(rows: ReviewRow[], build: (rows: ReviewRow[]) => RemovalMessage): Promise<AgentNotice[]>;
}
