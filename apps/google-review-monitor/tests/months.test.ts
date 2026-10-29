import { describe, expect, it } from "vitest";
import { toDiscovered } from "../src/asana/sync";
import { byMonthNewestFirst, settingsFor } from "../src/server/app";

describe("month picker order", () => {
  it("sorts by year and month newest first, whatever the name's layout, with non-month projects last", () => {
    const names = [
      "September Managed Disputes 2026",
      "December Managed Disputes 2025",
      "Managed Disputes Cancellations",
      "October Managed Disputes 2026",
      "Managed Disputes V2 July 2025 ",
      "Managed Disputes V2 2025 June",
      "August Managed Disputes  2025 ",
      "January Managed Disputes 2026",
      "Justin Example Toyota Managed Disputes",
    ];
    expect(names.map((name) => ({ name })).sort(byMonthNewestFirst).map((p) => p.name.trim())).toEqual([
      "October Managed Disputes 2026",
      "September Managed Disputes 2026",
      "January Managed Disputes 2026",
      "December Managed Disputes 2025",
      "August Managed Disputes  2025",
      "Managed Disputes V2 July 2025",
      "Managed Disputes V2 2025 June",
      "Justin Example Toyota Managed Disputes",
      "Managed Disputes Cancellations",
    ]);
  });
});

describe("Legacy months", () => {
  it("handles underscore names and lists Managed before Legacy within a month", () => {
    const names = ["May_2025 Legacy Monthly Disputes", "October 2026 Legacy Monthly Disputes", "October Managed Disputes 2026", "Managed Disputes V2 2025 May", "June_2025 Legacy Monthly Disputes"];
    expect(names.map((name) => ({ name })).sort(byMonthNewestFirst).map((p) => p.name)).toEqual([
      "October Managed Disputes 2026",
      "October 2026 Legacy Monthly Disputes",
      "June_2025 Legacy Monthly Disputes",
      "Managed Disputes V2 2025 May",
      "May_2025 Legacy Monthly Disputes",
    ]);
  });

  it("labels a Legacy project's reviews with the project name; Managed settings are left alone", () => {
    const base = { projectGid: "p", monthIndex: 1, locationIndex: 2, maxDepth: 3, includeCompleted: true, reviewerFromTitle: false };
    expect(settingsFor(base, " October 2026 Legacy Monthly Disputes ").monthLabel).toBe("October 2026 Legacy Monthly Disputes");
    expect(settingsFor(base, "October Managed Disputes 2026")).toBe(base);
  });
});

describe("Legacy review tasks", () => {
  it("section > dealership > dispute gives the dealership as location and the project as month", () => {
    const base = { projectGid: "p", monthIndex: 1, locationIndex: 2, maxDepth: 3, includeCompleted: true, reviewerFromTitle: false };
    const d = toDiscovered(
      {
        task: { gid: "1", name: "Dispute 1: Google - Bruce Howard", notes: "https://maps.app.goo.gl/abc", tags: [{ name: "Successfully removed" }] },
        path: ["Disputes Paid For", "Acura North Scottsdale", "Dispute 1: Google - Bruce Howard"],
        assignees: [null, null, null],
      },
      settingsFor(base, "October 2026 Legacy Monthly Disputes"),
    );
    expect(d).toMatchObject({ location: "Acura North Scottsdale", month: "October 2026 Legacy Monthly Disputes", reviewerName: "Bruce Howard", taggedRemoved: true });
  });
});
