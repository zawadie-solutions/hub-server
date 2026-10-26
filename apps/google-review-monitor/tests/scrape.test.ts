import { describe, expect, it } from "vitest";
import { classifyPage } from "../src/google/scrapeChecker";

// What headless Chrome's document.body.innerText looked like for a real, existing review.
const EXISTING = `Search Google Maps
Billion Auto - Toyota in Sioux Falls
Car dealer
PLACE DETAILS
Stephanie Rivera
a year ago
My oil change took 1 hour 20 mins. I am unsure as to why it took that long.
Like
Share
Collapse side panel
Sign in`;

const REMOVED = `Search Google Maps
Billion Auto - Toyota in Sioux Falls
Car dealer
This review is no longer available.
Collapse side panel`;

describe("scrape mode page reading", () => {
  it("calls a review removed only on Google's removal message", () => {
    expect(classifyPage(REMOVED, "Stephanie Rivera")).toEqual({ status: "REVIEW_REMOVED" });
    expect(classifyPage(REMOVED.replace("This review", "this   review"), null)).toEqual({ status: "REVIEW_REMOVED" });
  });

  it("sees an existing review by its reviewer", () => {
    expect(classifyPage(EXISTING, "Stephanie Rivera")).toEqual({ status: "REVIEW_EXISTS" });
  });

  it("sees an existing review card when the reviewer is unknown", () => {
    expect(classifyPage(EXISTING, null)).toEqual({ status: "REVIEW_EXISTS" });
  });

  it("sees a review card whose Like button shows a like count instead", () => {
    const liked = `Tasca Buick GMC Clearwater
Car dealer
Jeremy S.
8 years ago
The wait times for oil changes is unreasonable (90min).
2
Share
Response from the owner 8 years ago`;
    expect(classifyPage(liked, null)).toEqual({ status: "REVIEW_EXISTS" });
    expect(classifyPage(liked, "Jeremy S.")).toEqual({ status: "REVIEW_EXISTS" });
  });

  it("does not take someone else's review as this one", () => {
    expect(classifyPage(EXISTING, "Gabe Chapman").status).toBe("UNKNOWN");
  });

  it("treats a consent or unusual-traffic page as a failed source, not a verdict", () => {
    const consent = classifyPage("Before you continue to Google\nWe use cookies and data to", "Stephanie Rivera");
    expect(consent.status).toBe("UNKNOWN");
    expect(consent.status === "UNKNOWN" && consent.reason.startsWith("google check failed:")).toBe(true);
    expect(classifyPage("Our systems have detected unusual traffic from your computer network.", null).status).toBe("UNKNOWN");
  });

  it("never guesses on an empty or unclear page", () => {
    expect(classifyPage("", "Stephanie Rivera").status).toBe("UNKNOWN");
    expect(classifyPage("Search Google Maps\nSign in", null).status).toBe("UNKNOWN");
  });
});
