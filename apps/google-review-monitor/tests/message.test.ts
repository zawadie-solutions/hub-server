import { describe, expect, it } from "vitest";
import { buildRemovalMessage } from "../src/notify/message";
import type { ReviewRow } from "../src/types";

const row = (over: Partial<ReviewRow> = {}) =>
  ({
    location: "A & B Lawn and Garden Managed Reputation Lite (5)",
    reviewer_name: "Susan Gaynor",
    assignee_name: "Joseph Mukele",
    location_assignee_name: null,
    rating: 1,
    asana_task_url: "https://app.asana.com/1/687648934845630/task/1219043046265466",
    google_review_url: "https://maps.app.goo.gl/SP7hAcGTiSuWvvWWA",
    ...over,
  }) as ReviewRow;

describe("removal alert", () => {
  it("lists location, reviewer, who worked on it, the Asana task and the Google review, in that order", () => {
    const { subject, text } = buildRemovalMessage([row()]);
    expect(subject).toBe("Google Review Removed");
    expect(text).toContain(
      [
        "Location: A & B Lawn and Garden Managed Reputation Lite (5)",
        "Reviewer: Susan Gaynor",
        "Worked on by: Joseph Mukele",
        "Asana task: https://app.asana.com/1/687648934845630/task/1219043046265466",
        "Google review: https://maps.app.goo.gl/SP7hAcGTiSuWvvWWA",
      ].join("\n"),
    );
  });

  it("never includes the rating", () => {
    const { text, html } = buildRemovalMessage([row({ rating: 1 }), row({ rating: null })]);
    for (const body of [text, html]) {
      expect(body).not.toMatch(/rating/i);
      expect(body).not.toMatch(/star/i);
    }
  });

  it("falls back to the location's assignee", () => {
    expect(buildRemovalMessage([row({ assignee_name: null, location_assignee_name: "Lena Fischer" })]).text).toContain("Worked on by: Lena Fischer");
  });

  it("puts reviews nobody is assigned to last, under their own heading", () => {
    const { text, html } = buildRemovalMessage([
      row({ reviewer_name: "Nobody's 1", assignee_name: null }),
      row({ reviewer_name: "Joseph's", assignee_name: "Joseph Mukele" }),
      row({ reviewer_name: "Nobody's 2", assignee_name: null }),
    ]);
    expect(text).toContain("Google Reviews Removed (3)");
    const head = text.indexOf("Not assigned in Asana (2 reviews)");
    expect(head).toBeGreaterThan(text.indexOf("Reviewer: Joseph's"));
    expect(text.indexOf("Reviewer: Nobody's 1")).toBeGreaterThan(head);
    expect(text.indexOf("Reviewer: Nobody's 2")).toBeGreaterThan(head);
    // The heading says it; each entry does not repeat it.
    expect(text).not.toContain("nobody assigned");
    expect(text.match(/Worked on by:/g)).toHaveLength(1);
    expect(html).toContain("<h3>Not assigned in Asana (2 reviews)</h3>");
  });

  it("has no unassigned heading when everyone's reviews are assigned", () => {
    const { text, html } = buildRemovalMessage([row()]);
    expect(text).not.toContain("Not assigned");
    expect(html).not.toContain("<h3>");
  });

  it("says 1 review for a single unassigned one, even when it is the only review", () => {
    const { text } = buildRemovalMessage([row({ assignee_name: null })]);
    expect(text).toContain("Google Review Removed\n\nNot assigned in Asana (1 review)\n\nLocation:");
  });

  it("escapes the HTML version", () => {
    const { html } = buildRemovalMessage([row()]);
    expect(html).toContain("A &amp; B Lawn and Garden");
    expect(html).toContain('<a href="https://app.asana.com/1/687648934845630/task/1219043046265466">');
  });
});
