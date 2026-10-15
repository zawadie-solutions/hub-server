import { describe, expect, it } from "vitest";
import { FallbackChecker } from "../src/google/fallbackChecker";
import type { CheckResult, ReviewToCheck } from "../src/types";
import { fakeChecker } from "./helpers";

const EXISTS = { status: "REVIEW_EXISTS" } as const;
const REMOVED = { status: "REVIEW_REMOVED" } as const;
const FAILED: CheckResult = { status: "UNKNOWN", reason: "google check failed: DataForSEO: Payment Required." };
const TOO_OLD: CheckResult = { status: "UNKNOWN", reason: "not among the newest 200 reviews listed (284 on Google)" };

describe("FallbackChecker", () => {
  const input: ReviewToCheck = { id: 1, googleReviewUrl: "https://maps.app.goo.gl/x", location: "Location A", reviewerName: "John Smith", rating: 1 };
  const names = { primary: "dataforseo", fallback: "apify" };

  it("the primary's answer stands, and the fallback is not called, when the primary answered", async () => {
    for (const answer of [EXISTS, REMOVED, TOO_OLD]) {
      const fallback = fakeChecker(EXISTS);
      expect(await new FallbackChecker(fakeChecker(answer), fallback, names).checkReview(input)).toEqual(answer);
      expect(fallback.calls).toBe(0);
    }
  });

  it("the fallback answers when the primary source itself failed", async () => {
    for (const answer of [EXISTS, REMOVED]) {
      const fallback = fakeChecker(answer);
      expect(await new FallbackChecker(fakeChecker(FAILED), fallback, names).checkReview(input)).toEqual(answer);
      expect(fallback.calls).toBe(1);
    }
  });

  it("both failing -> UNKNOWN naming both reasons", async () => {
    const r = await new FallbackChecker(fakeChecker(FAILED), fakeChecker(TOO_OLD), names).checkReview(input);
    expect(r).toEqual({ status: "UNKNOWN", reason: `dataforseo: ${FAILED.reason}; apify: ${TOO_OLD.reason}` });
  });

  it("prepare reaches the primary only", async () => {
    const seen: string[] = [];
    const withPrepare = (name: string) => ({ ...fakeChecker(EXISTS), prepare: async () => void seen.push(name) });
    await new FallbackChecker(withPrepare("primary"), withPrepare("fallback"), names).prepare([input]);
    expect(seen).toEqual(["primary"]);
  });
});
