import type { Db } from "./db";
import type { CheckResult, DiscoveredReview, ReviewRow } from "../types";

export interface DayActivity {
  date: string;
  checked: number;
  removed: number;
  removedDetails: { location: string | null; reviewerName: string | null }[];
}

export interface AsanaProjectRow {
  project_gid: string;
  display_name: string;
  last_synced_at: Date | null;
  last_review_count: number | null;
  run_status: "idle" | "running" | "done" | "failed";
  last_run_error: string | null;
  updated_at: Date;
}

export interface AuditRow {
  id: number;
  at: Date;
  /** The dashboard user, or "scheduler" / "system" for things the app did by itself. */
  actor: string;
  /** Machine key, grouped by prefix: run.*, location.*, google.*, settings.*, daily.*, system.* */
  action: string;
  summary: string;
}

export class ReviewRepo {
  constructor(private db: Db) {}

  /** Insert a new review or refresh Asana metadata. Returns true if newly created. */
  async upsertDiscovered(d: DiscoveredReview): Promise<boolean> {
    const existing = await this.db.query<ReviewRow>("SELECT * FROM reviews WHERE asana_task_id = $1", [d.asanaTaskId]);
    const row = existing.rows[0];
    if (!row) {
      await this.db.query(
        `INSERT INTO reviews (asana_task_id, asana_task_name, asana_task_url, asana_project_gid, location, month,
           reviewer_name, rating, review_text, google_review_url, assignee_name, location_assignee_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          d.asanaTaskId,
          d.asanaTaskName,
          d.asanaTaskUrl,
          d.asanaProjectGid,
          d.location,
          d.month,
          d.reviewerName,
          d.rating,
          d.reviewText,
          d.googleReviewUrl,
          d.assigneeName,
          d.locationAssigneeName,
        ],
      );
      return true;
    }
    // If the link was replaced the old verdict no longer applies: start over.
    const urlChanged = row.google_review_url !== d.googleReviewUrl;
    await this.db.query(
      `UPDATE reviews SET asana_task_name=$2, asana_task_url=$3, asana_project_gid=$4, location=$5, month=$6, reviewer_name=$7,
         rating=$8, google_review_url=$9, review_text=$10, assignee_name=$11, location_assignee_name=$12, updated_at=now(3)
         ${urlChanged ? ", status='UNKNOWN', removed_at=NULL, notification_sent=false, notification_sent_at=NULL, monitoring_active=true, last_error=NULL" : ""}
       WHERE id=$1`,
      [
        row.id,
        d.asanaTaskName,
        d.asanaTaskUrl,
        d.asanaProjectGid,
        d.location,
        d.month,
        d.reviewerName,
        d.rating,
        d.googleReviewUrl,
        d.reviewText,
        d.assigneeName,
        d.locationAssigneeName,
      ],
    );
    return false;
  }

  async listToCheck(): Promise<ReviewRow[]> {
    const r = await this.db.query<ReviewRow>("SELECT * FROM reviews WHERE monitoring_active = true ORDER BY id");
    return r.rows;
  }

  async all(): Promise<ReviewRow[]> {
    const r = await this.db.query<ReviewRow>("SELECT * FROM reviews ORDER BY id");
    return r.rows;
  }

  /** Reviews currently flagged as removed, most recent first — what the dashboard needs attention on. */
  async removedReviews(opts: { projectGid?: string; limit?: number } = {}): Promise<ReviewRow[]> {
    const p: unknown[] = [];
    const proj = opts.projectGid ? `AND asana_project_gid = $${p.push(opts.projectGid)}` : "";
    const limit = opts.limit ?? 100;
    const r = await this.db.query<ReviewRow>(
      `SELECT * FROM reviews WHERE status='REVIEW_REMOVED' ${proj} ORDER BY removed_at DESC, id DESC LIMIT $${p.push(limit)}`,
      p,
    );
    return r.rows;
  }

  /** Every Asana project with synced reviews, most recently synced first — the dashboard's month filter options. */
  async distinctProjects(): Promise<{ projectGid: string; month: string | null; count: number }[]> {
    const r = await this.db.query<{ asana_project_gid: string; month: string | null; n: string }>(
      `SELECT asana_project_gid, MAX(month) AS month, COUNT(*) AS n FROM reviews
       WHERE asana_project_gid IS NOT NULL GROUP BY asana_project_gid ORDER BY MAX(created_at) DESC`,
    );
    return r.rows.map((x) => ({ projectGid: x.asana_project_gid, month: x.month, count: Number(x.n) }));
  }

  /** Locations with reviews, alphabetical — the dashboard's location picker options. */
  async locations(projectGid?: string): Promise<{ location: string | null; count: number }[]> {
    const p: unknown[] = [];
    const where = projectGid ? `WHERE asana_project_gid = $${p.push(projectGid)}` : "";
    const r = await this.db.query<{ location: string | null; n: string }>(
      `SELECT location, COUNT(*) AS n FROM reviews ${where} GROUP BY location ORDER BY location IS NULL, location`,
      p,
    );
    return r.rows.map((x) => ({ location: x.location, count: Number(x.n) }));
  }

  /** Every review of one location (null = reviews with no location), in Asana order. */
  async reviewsByLocation(opts: { projectGid?: string; location: string | null }): Promise<ReviewRow[]> {
    const p: unknown[] = [];
    const loc = opts.location === null ? "location IS NULL" : `location = $${p.push(opts.location)}`;
    const proj = opts.projectGid ? `AND asana_project_gid = $${p.push(opts.projectGid)}` : "";
    const r = await this.db.query<ReviewRow>(`SELECT * FROM reviews WHERE ${loc} ${proj} ORDER BY id`, p);
    return r.rows;
  }

  async summary(projectGid?: string) {
    const p: unknown[] = [];
    const where = projectGid ? `WHERE asana_project_gid = $${p.push(projectGid)}` : "";
    const r = await this.db.query<{ status: string; n: string }>(`SELECT status, COUNT(*) AS n FROM reviews ${where} GROUP BY status`, p);
    const by = Object.fromEntries(r.rows.map((x) => [x.status, Number(x.n)]));
    const m = await this.db.query<{ last_check: Date | null; last_notified: Date | null; failing: string | null }>(
      `SELECT MAX(last_checked_at) AS last_check, MAX(notification_sent_at) AS last_notified,
              SUM(CASE WHEN status='REVIEW_REMOVED' AND notification_sent=false AND last_notification_error IS NOT NULL THEN 1 ELSE 0 END) AS failing
       FROM reviews ${where}`,
      p,
    );
    return {
      monitored: Object.values(by).reduce((a, b) => a + b, 0),
      exists: by.REVIEW_EXISTS ?? 0,
      removed: by.REVIEW_REMOVED ?? 0,
      unknown: by.UNKNOWN ?? 0,
      lastCheckAt: m.rows[0]?.last_check ?? null,
      lastNotificationAt: m.rows[0]?.last_notified ?? null,
      notificationsFailing: Number(m.rows[0]?.failing ?? 0),
    };
  }

  /** Daily digest of check activity for the "Recent activity" feed, most recent day first. */
  async recentActivity(opts: { days?: number; projectGid?: string } = {}): Promise<DayActivity[]> {
    const days = opts.days ?? 14;
    if (!Number.isInteger(days) || days <= 0) throw new Error("days must be a positive integer");
    const p: unknown[] = [];
    const proj = opts.projectGid ? `AND r.asana_project_gid = $${p.push(opts.projectGid)}` : "";
    const r = await this.db.query<{ checked_at: Date; result: string; location: string | null; reviewer_name: string | null }>(
      `SELECT h.checked_at, h.result, r.location, r.reviewer_name
       FROM review_check_history h JOIN reviews r ON r.id = h.review_id
       WHERE h.checked_at >= now(3) - INTERVAL ${days} DAY ${proj}
       ORDER BY h.checked_at DESC`,
      p,
    );
    const byDay = new Map<string, DayActivity>();
    for (const row of r.rows) {
      const date = new Date(row.checked_at).toISOString().slice(0, 10);
      const bucket = byDay.get(date) ?? { date, checked: 0, removed: 0, removedDetails: [] };
      bucket.checked += 1;
      if (row.result === "REVIEW_REMOVED") {
        bucket.removed += 1;
        bucket.removedDetails.push({ location: row.location, reviewerName: row.reviewer_name });
      }
      byDay.set(date, bucket);
    }
    return [...byDay.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  async history(reviewId: number) {
    const r = await this.db.query("SELECT checked_at, result, reason FROM review_check_history WHERE review_id=$1 ORDER BY id", [
      reviewId,
    ]);
    return r.rows;
  }

  /**
   * Persist a check outcome and its history row.
   * - UNKNOWN never overwrites a REMOVED verdict, and never touches notification state.
   * - EXISTS after REMOVED = review reappeared: clear removal so a later removal notifies again.
   */
  async recordCheck(review: ReviewRow, result: CheckResult): Promise<void> {
    const reason = result.status === "UNKNOWN" ? result.reason : null;
    await this.db.query("INSERT INTO review_check_history (review_id, result, reason) VALUES ($1,$2,$3)", [
      review.id,
      result.status,
      reason,
    ]);
    if (result.status === "REVIEW_EXISTS") {
      await this.db.query(
        `UPDATE reviews SET status='REVIEW_EXISTS', last_checked_at=now(3), last_error=NULL, removed_at=NULL,
           notification_sent=false, notification_sent_at=NULL, monitoring_active=true, updated_at=now(3) WHERE id=$1`,
        [review.id],
      );
    } else if (result.status === "REVIEW_REMOVED") {
      await this.db.query(
        `UPDATE reviews SET status='REVIEW_REMOVED', last_checked_at=now(3), last_error=NULL,
           removed_at=COALESCE(removed_at, now(3)), updated_at=now(3) WHERE id=$1`,
        [review.id],
      );
    } else if (review.status === "REVIEW_REMOVED") {
      await this.db.query("UPDATE reviews SET last_checked_at=now(3), last_error=$2, updated_at=now(3) WHERE id=$1", [
        review.id,
        reason,
      ]);
    } else {
      await this.db.query(
        "UPDATE reviews SET status='UNKNOWN', last_checked_at=now(3), last_error=$2, updated_at=now(3) WHERE id=$1",
        [review.id, reason],
      );
    }
  }

  async listByAsanaTaskIds(ids: string[]): Promise<ReviewRow[]> {
    if (!ids.length) return [];
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");
    const r = await this.db.query<ReviewRow>(`SELECT * FROM reviews WHERE asana_task_id IN (${placeholders})`, ids);
    return r.rows;
  }

  /** Takes reviews out of the daily automated cycle (used after an on-demand historical check). */
  async setMonitoringActive(ids: number[], active: boolean): Promise<void> {
    if (!ids.length) return;
    const placeholders = ids.map((_, i) => `$${i + 2}`).join(",");
    await this.db.query(`UPDATE reviews SET monitoring_active = $1, updated_at = now(3) WHERE id IN (${placeholders})`, [active, ...ids]);
  }

  /** Every "<Month> Managed Disputes <Year>" project seen so far, for the dashboard's month picker. */
  async listAsanaProjects(): Promise<AsanaProjectRow[]> {
    const r = await this.db.query<AsanaProjectRow>("SELECT * FROM asana_month_projects ORDER BY display_name");
    return r.rows;
  }

  /** Records that a project exists, without touching its sync/run state if already known. */
  async noteAsanaProjectSeen(projectGid: string, displayName: string): Promise<void> {
    await this.db.query(
      `INSERT INTO asana_month_projects (project_gid, display_name) VALUES ($1,$2)
       ON DUPLICATE KEY UPDATE display_name = $2`,
      [projectGid, displayName],
    );
  }

  /**
   * Claims this project for a run. Returns false if another run is already in progress for
   * it (unless that run has been stuck for over `staleMinutes`, in which case it's reclaimed —
   * guards against a crashed process leaving run_status stuck at 'running' forever).
   */
  async tryStartAsanaRun(projectGid: string, displayName: string, staleMinutes = 20): Promise<boolean> {
    if (!Number.isInteger(staleMinutes) || staleMinutes <= 0) throw new Error("staleMinutes must be a positive integer");
    await this.noteAsanaProjectSeen(projectGid, displayName);
    const r = await this.db.query(
      `UPDATE asana_month_projects SET run_status='running', last_run_error=NULL, updated_at=now(3)
       WHERE project_gid=$1 AND (run_status <> 'running' OR updated_at < now(3) - INTERVAL ${staleMinutes} MINUTE)`,
      [projectGid],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /**
   * Runs live inside the server process, so any project still marked 'running' when the
   * server starts was cut off by a restart. Marks those failed so the dashboard's Run button
   * is usable again. Returns how many were cleared.
   */
  async clearInterruptedRuns(): Promise<number> {
    const r = await this.db.query(
      `UPDATE asana_month_projects SET run_status='failed',
         last_run_error='interrupted: the app was restarted before the check finished', updated_at=now(3)
       WHERE run_status='running'`,
    );
    return r.rowCount ?? 0;
  }

  /** Every review stored for one Asana project (month). */
  async reviewsByProject(projectGid: string): Promise<ReviewRow[]> {
    const r = await this.db.query<ReviewRow>("SELECT * FROM reviews WHERE asana_project_gid = $1 ORDER BY id", [projectGid]);
    return r.rows;
  }

  /** Records that the project was just read from Asana, whatever happens to the rest of the run. */
  async markSynced(projectGid: string): Promise<void> {
    await this.db.query("UPDATE asana_month_projects SET last_synced_at = now(3) WHERE project_gid = $1", [projectGid]);
  }

  async finishAsanaRun(projectGid: string, result: { ok: true; reviewCount: number; synced?: boolean } | { ok: false; error: string }): Promise<void> {
    if (result.ok) {
      await this.db.query(
        `UPDATE asana_month_projects SET run_status='done', last_synced_at=IF($3, now(3), last_synced_at), last_review_count=$2,
           last_run_error=NULL, updated_at=now(3) WHERE project_gid=$1`,
        [projectGid, result.reviewCount, result.synced === false ? 0 : 1],
      );
    } else {
      await this.db.query(
        "UPDATE asana_month_projects SET run_status='failed', last_run_error=$2, updated_at=now(3) WHERE project_gid=$1",
        [projectGid, result.error],
      );
    }
  }

  /** Appends one line to the audit log. */
  async addAudit(e: { actor: string; action: string; summary: string }): Promise<void> {
    await this.db.query("INSERT INTO audit_log (actor, action, summary) VALUES ($1,$2,$3)", [e.actor, e.action, e.summary]);
  }

  /**
   * Audit entries, newest first. `prefixes` keeps only actions starting with one of them
   * (e.g. ["run.", "location."]); `beforeId` pages further back.
   */
  async listAudit(opts: { limit?: number; beforeId?: number; prefixes?: string[] } = {}): Promise<AuditRow[]> {
    const p: unknown[] = [];
    const where: string[] = [];
    if (opts.beforeId) where.push(`id < $${p.push(opts.beforeId)}`);
    if (opts.prefixes?.length) where.push(`(${opts.prefixes.map((x) => `action LIKE $${p.push(`${x}%`)}`).join(" OR ")})`);
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const r = await this.db.query<AuditRow>(
      `SELECT id, at, actor, action, summary FROM audit_log ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT $${p.push(limit)}`,
      p,
    );
    return r.rows;
  }

  /** Settings saved from the dashboard (key -> value); empty when none were ever changed. */
  async getSettings(): Promise<Record<string, string>> {
    const r = await this.db.query<{ name: string; value: string }>("SELECT name, value FROM app_settings");
    return Object.fromEntries(r.rows.map((x) => [x.name, x.value]));
  }

  async saveSettings(values: Record<string, string>, actor: string): Promise<void> {
    for (const [key, value] of Object.entries(values)) {
      await this.db.query(
        `INSERT INTO app_settings (name, value, updated_by) VALUES ($1,$2,$3)
         ON DUPLICATE KEY UPDATE value = $2, updated_by = $3, updated_at = now(3)`,
        [key, value, actor],
      );
    }
  }

  /** Forgets every dashboard-saved setting, so .env applies again. */
  async clearSettings(): Promise<void> {
    await this.db.query("DELETE FROM app_settings");
  }

  async pendingNotifications(): Promise<ReviewRow[]> {
    const r = await this.db.query<ReviewRow>(
      "SELECT * FROM reviews WHERE status='REVIEW_REMOVED' AND notification_sent=false ORDER BY removed_at, id",
    );
    return r.rows;
  }

  /** Guarded by notification_sent=false so a repeated call can never double-mark. */
  async markNotified(ids: number[], stopChecking: boolean): Promise<void> {
    for (const id of ids) {
      await this.db.query(
        `UPDATE reviews SET notification_sent=true, notification_sent_at=now(3), last_notification_error=NULL,
           monitoring_active=$2, updated_at=now(3) WHERE id=$1 AND notification_sent=false`,
        [id, !stopChecking],
      );
    }
  }

  async markNotificationFailed(ids: number[], error: string): Promise<void> {
    for (const id of ids) {
      await this.db.query(
        `UPDATE reviews SET notification_attempts=notification_attempts+1, last_notification_error=$2,
           updated_at=now(3) WHERE id=$1`,
        [id, error],
      );
    }
  }
}
