import { type ReviewRow, workedOnBy } from "../types";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** One digest email for all newly removed reviews. */
export function buildRemovalMessage(rows: ReviewRow[]) {
  const n = rows.length;
  const subject = n === 1 ? "Google Review Removed" : `Google Reviews Removed (${n})`;
  const stars = (r: ReviewRow) => (r.rating ? `${r.rating} star${r.rating === 1 ? "" : "s"}` : "n/a");

  const text = [
    subject,
    "",
    ...rows.map((r) =>
      [
        `Location: ${r.location ?? "n/a"}`,
        `Reviewer: ${r.reviewer_name ?? "n/a"}`,
        `Worked on by: ${workedOnBy(r) ?? "nobody assigned in Asana"}`,
        `Rating: ${stars(r)}`,
        `Asana task: ${r.asana_task_url}`,
        `Google review: ${r.google_review_url}`,
        "",
      ].join("\n"),
    ),
    n === 1
      ? "The Google review associated with this Asana task is no longer visible."
      : "The Google reviews associated with these Asana tasks are no longer visible.",
  ].join("\n");

  const html = `<h2>${esc(subject)}</h2>${rows
    .map(
      (r) => `<p><b>Location:</b> ${esc(r.location ?? "n/a")}<br>
<b>Reviewer:</b> ${esc(r.reviewer_name ?? "n/a")}<br>
<b>Worked on by:</b> ${esc(workedOnBy(r) ?? "nobody assigned in Asana")}<br>
<b>Rating:</b> ${esc(stars(r))}<br>
<a href="${esc(r.asana_task_url)}">Asana task</a> · <a href="${esc(r.google_review_url)}">Google review</a></p>`,
    )
    .join("")}<p>${n === 1 ? "The Google review associated with this Asana task is" : "The Google reviews associated with these Asana tasks are"} no longer visible.</p>`;

  return { subject, text, html };
}
