import { describe, expect, it } from "vitest";
import { isGoogleReviewUrl, parseRating, parseReviewerFromTitle, parseReviewerName, parseReviewText, pickGoogleReviewUrl } from "../src/asana/extract";

describe("url extraction", () => {
  it("picks the Google review link among several URLs and strips trailing punctuation", () => {
    const notes = "Dispute form: https://forms.example.com/x\nReview: https://www.google.com/maps/reviews/data=!4m8!14m7. Thanks";
    expect(pickGoogleReviewUrl(notes)).toBe("https://www.google.com/maps/reviews/data=!4m8!14m7");
  });
  it("reads hrefs from html_notes and decodes &amp;", () => {
    const html = '<body><a href="https://www.google.com/maps/place/X?a=1&amp;b=2">link</a></body>';
    expect(pickGoogleReviewUrl("link", html)).toBe("https://www.google.com/maps/place/X?a=1&b=2");
  });
  it("prefers review links over plain place links", () => {
    const n = "https://www.google.com/maps/place/Foo https://www.google.com/maps/reviews/data=abc";
    expect(pickGoogleReviewUrl(n)).toContain("/reviews/");
  });
  it("accepts short links and rejects non-Google or non-map URLs", () => {
    expect(isGoogleReviewUrl("https://maps.app.goo.gl/abc123")).toBe(true);
    expect(isGoogleReviewUrl("https://g.page/r/xyz/review")).toBe(true);
    expect(isGoogleReviewUrl("https://www.google.com/search?q=x")).toBe(false);
    expect(isGoogleReviewUrl("https://notgoogle.com/maps/x")).toBe(false);
    expect(isGoogleReviewUrl("ftp://www.google.com/maps")).toBe(false);
    expect(pickGoogleReviewUrl("no links here")).toBeNull();
  });
  it("parses reviewer and rating", () => {
    expect(parseReviewerName("Reviewer: John Smith\nfoo")).toBe("John Smith");
    expect(parseRating("Rating: 1")).toBe(1);
    expect(parseRating("a 5-star review")).toBe(5);
    expect(parseRating("nothing")).toBeNull();
  });
  it("reads the reviewer from a 'Name : link' line or the task title", () => {
    expect(parseReviewerName("Mike Andrews : https://maps.app.goo.gl/abc")).toBe("Mike Andrews");
    expect(parseReviewerName("https://maps.app.goo.gl/abc")).toBeNull();
    expect(parseReviewerFromTitle("Dispute 1: Google - Mike Andrews")).toBe("Mike Andrews");
    expect(parseReviewerFromTitle("Dispute 2")).toBeNull();
    // no space after the hyphen, hyphenated names, and a title that stops at the hyphen
    expect(parseReviewerFromTitle("Dispute 3: Google-Kimberly Dickson")).toBe("Kimberly Dickson");
    expect(parseReviewerFromTitle("Dispute 4: Google -michelo eisel")).toBe("michelo eisel");
    expect(parseReviewerFromTitle("Dispute 1: Google - Laura Lewis-Barr")).toBe("Laura Lewis-Barr");
    expect(parseReviewerFromTitle("Dispute 2 Google-")).toBeNull();
    // a description that holds only the name
    expect(parseReviewerName("Kelley Williams\nhttps://maps.app.goo.gl/abc")).toBe("Kelley Williams");
    expect(parseReviewerName("Akshat Sharma- https://maps.app.goo.gl/abc")).toBe("Akshat Sharma");
    expect(parseReviewerName("Administrator -\nhttps://maps.app.goo.gl/abc")).toBe("Administrator");
    expect(parseReviewerName("Terrible service. Would not recommend!\nhttps://maps.app.goo.gl/abc")).toBeNull();
    expect(parseReviewerName("First line\nSecond line\nhttps://maps.app.goo.gl/abc")).toBeNull();
    expect(parseReviewText("Mike Andrews : https://maps.app.goo.gl/abc")).toBeNull();
  });
  it("extracts review text", () => {
    const url = "https://www.google.com/maps/reviews/x";
    expect(parseReviewText(`Reviewer: A\nRating: 1\nReview: Bad food.\nSecond line\n${url}`)).toBe("Bad food.\nSecond line");
    expect(parseReviewText(`Reviewer: A\nRating: 1\nAwful place\n${url}`)).toBe("Awful place");
    expect(parseReviewText(url)).toBeNull();
  });
});
