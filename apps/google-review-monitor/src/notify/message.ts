import type { ReviewRow } from "../types";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * One digest email for all newly removed reviews. Kept to what the checker needs: the
 * location, the reviewer (to search for in Asana) and the Google link. No agent, rating or task link.
 */
export function buildRemovalMessage(rows: ReviewRow[]) {
  const n = rows.length;
  const subject = n === 1 ? "Google Review Removed" : `Google Reviews Removed (${n})`;
  const outro = n === 1 ? "This Google review is no longer visible." : "These Google reviews are no longer visible.";

  const text = [
    subject,
    "",
    ...rows.map((r) =>
      [`Location: ${r.location ?? "n/a"}`, `Reviewer: ${r.reviewer_name ?? "n/a"}`, `Google review: ${r.google_review_url}`, ""].join("\n"),
    ),
    outro,
  ].join("\n");

  const html = `<h2>${esc(subject)}</h2>${rows
    .map(
      (r) => `<p><b>Location:</b> ${esc(r.location ?? "n/a")}<br>
<b>Reviewer:</b> ${esc(r.reviewer_name ?? "n/a")}<br>
<a href="${esc(r.google_review_url)}">Google review</a></p>`,
    )
    .join("")}<p>${outro}</p>`;

  return { subject, text, html };
}
