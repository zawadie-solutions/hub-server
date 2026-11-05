import { type ReviewRow, workedOnBy } from "../types";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const count = (n: number) => `${n} review${n === 1 ? "" : "s"}`;

/**
 * One digest email for all newly removed reviews. The rating is left out on purpose.
 * Reviews nobody is assigned to in Asana come last, under their own heading, so they stand out.
 */
export function buildRemovalMessage(rows: ReviewRow[]) {
  const n = rows.length;
  const subject = n === 1 ? "Google Review Removed" : `Google Reviews Removed (${n})`;
  const outro =
    n === 1
      ? "The Google review associated with this Asana task is no longer visible."
      : "The Google reviews associated with these Asana tasks are no longer visible.";
  const assigned = rows.filter((r) => workedOnBy(r));
  const unassigned = rows.filter((r) => !workedOnBy(r));
  const unassignedHead = `Not assigned in Asana (${count(unassigned.length)})`;

  const entry = (r: ReviewRow) =>
    [
      `Location: ${r.location ?? "n/a"}`,
      `Reviewer: ${r.reviewer_name ?? "n/a"}`,
      ...(workedOnBy(r) ? [`Worked on by: ${workedOnBy(r)}`] : []),
      `Asana task: ${r.asana_task_url}`,
      `Google review: ${r.google_review_url}`,
      "",
    ].join("\n");
  const text = [
    subject,
    "",
    ...assigned.map(entry),
    ...(unassigned.length ? [unassignedHead, "", ...unassigned.map(entry)] : []),
    outro,
  ].join("\n");

  const entryHtml = (r: ReviewRow) => `<p><b>Location:</b> ${esc(r.location ?? "n/a")}<br>
<b>Reviewer:</b> ${esc(r.reviewer_name ?? "n/a")}<br>
${workedOnBy(r) ? `<b>Worked on by:</b> ${esc(workedOnBy(r)!)}<br>\n` : ""}<b>Asana task:</b> <a href="${esc(r.asana_task_url)}">${esc(r.asana_task_url)}</a><br>
<b>Google review:</b> <a href="${esc(r.google_review_url)}">${esc(r.google_review_url)}</a></p>`;
  const html = `<h2>${esc(subject)}</h2>${assigned.map(entryHtml).join("")}${
    unassigned.length ? `<h3>${esc(unassignedHead)}</h3>${unassigned.map(entryHtml).join("")}` : ""
  }<p>${esc(outro)}</p>`;

  return { subject, text, html };
}
