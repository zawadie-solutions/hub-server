import { describe, expect, it, vi } from "vitest";

// The browser is never started in these tests.
vi.mock("../lib/render.js", () => ({ renderReviewPage: vi.fn(async (url: string) => ({ finalUrl: url, text: "rendered" })) }));

const { default: handler } = await import("../api/render.js");
const { allowedReviewUrl, authorized } = await import("../lib/validate.js");

function call(opts: { method?: string; auth?: string; body?: unknown }) {
  const res = {
    statusCode: 0,
    payload: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: unknown) {
      this.payload = data;
      return this;
    },
  };
  const req = { method: opts.method ?? "POST", headers: { authorization: opts.auth }, body: opts.body };
  return Promise.resolve(handler(req as never, res as never)).then(() => res);
}

describe("authorization", () => {
  it("accepts only the configured secret", () => {
    expect(authorized("Bearer s3cret", "s3cret")).toBe(true);
    expect(authorized("Bearer wrong", "s3cret")).toBe(false);
    expect(authorized(undefined, "s3cret")).toBe(false);
    expect(authorized("s3cret", "s3cret")).toBe(false); // must be a Bearer token
  });

  it("never runs open when no secret is configured", () => {
    expect(authorized("Bearer anything", undefined)).toBe(false);
    expect(authorized("Bearer ", "")).toBe(false);
  });
});

describe("allowed links", () => {
  it.each([
    "https://maps.app.goo.gl/5jBQV7911im7EhNa6",
    "https://www.google.com/maps/reviews/data=!4m8!14m7",
    "https://www.google.co.uk/maps/place/x",
  ])("allows %s", (url) => {
    expect(allowedReviewUrl(url)).not.toBeNull();
  });

  it.each([
    "http://maps.app.goo.gl/abc", // not https
    "https://evil.com/maps",
    "https://maps.app.goo.gl.evil.com/x",
    "https://www.google.com/search?q=x", // google, but not maps
    "https://user:pw@maps.app.goo.gl/x",
    "https://maps.app.goo.gl:8443/x",
    "http://169.254.169.254/latest/meta-data",
    "not a url",
    42,
  ])("refuses %s", (url) => {
    expect(allowedReviewUrl(url)).toBeNull();
  });
});

describe("POST /api/render", () => {
  process.env.SCRAPER_API_SECRET = "s3cret";

  it("refuses other methods", async () => {
    expect((await call({ method: "GET", auth: "Bearer s3cret" })).statusCode).toBe(405);
  });

  it("refuses a wrong secret", async () => {
    expect((await call({ auth: "Bearer nope", body: { url: "https://maps.app.goo.gl/x" } })).statusCode).toBe(401);
  });

  it("refuses a non-review link", async () => {
    expect((await call({ auth: "Bearer s3cret", body: { url: "https://evil.com/" } })).statusCode).toBe(400);
  });

  it("renders an allowed link", async () => {
    const res = await call({ auth: "Bearer s3cret", body: { url: "https://maps.app.goo.gl/x" } });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({ finalUrl: "https://maps.app.goo.gl/x", text: "rendered" });
  });

  it("accepts a JSON string body", async () => {
    const res = await call({ auth: "Bearer s3cret", body: JSON.stringify({ url: "https://maps.app.goo.gl/x" }) });
    expect(res.statusCode).toBe(200);
  });
});
