import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ReviewRepo } from "../src/db/repo";
import { createApp } from "../src/server/app";
import { createSession, LoginThrottle, readCookie, SESSION_TTL_MS, verifySession } from "../src/server/session";

describe("sessions", () => {
  it("a session verifies only with the same password, unaltered and unexpired", () => {
    const now = 1_000_000;
    const token = createSession("admin", "s3cret", now);
    expect(verifySession(token, "s3cret", now + 1000)).toBe("admin");
    expect(verifySession(token, "other-password", now + 1000)).toBeNull();
    expect(verifySession(token, "s3cret", now + SESSION_TTL_MS + 1)).toBeNull();
    const [user, expiry, sig] = token.split(".");
    expect(verifySession(`${Buffer.from("root").toString("base64url")}.${expiry}.${sig}`, "s3cret", now)).toBeNull();
    expect(verifySession(`${user}.${Number(expiry) + 999999}.${sig}`, "s3cret", now)).toBeNull();
    expect(verifySession(undefined, "s3cret")).toBeNull();
    expect(verifySession("garbage", "s3cret")).toBeNull();
  });

  it("reads one cookie out of a Cookie header", () => {
    expect(readCookie("a=1; grm_session=abc.def; b=2", "grm_session")).toBe("abc.def");
    expect(readCookie("a=1", "grm_session")).toBeUndefined();
    expect(readCookie(undefined, "grm_session")).toBeUndefined();
  });

  it("the throttle blocks after repeated wrong attempts, then lets go", () => {
    const t = new LoginThrottle(3, 60_000);
    for (let i = 0; i < 3; i++) {
      expect(t.blockedFor("1.2.3.4", 1000)).toBe(0);
      t.failed("1.2.3.4", 1000);
    }
    expect(t.blockedFor("1.2.3.4", 2000)).toBe(1);
    expect(t.blockedFor("5.6.7.8", 2000)).toBe(0); // another address is unaffected
    expect(t.blockedFor("1.2.3.4", 62_000)).toBe(0); // the window has passed
    t.failed("9.9.9.9", 1000);
    t.succeeded("9.9.9.9");
    expect(t.blockedFor("9.9.9.9", 1001)).toBe(0);
  });
});

describe("dashboard sign-in", () => {
  let base = "";
  let close: () => void = () => {};
  beforeAll(async () => {
    // No endpoint used here reaches the database.
    const app = createApp({ repo: {} as ReviewRepo, user: "admin", password: "s3cret", scheduleCron: "0 7 * * *", timezone: "Africa/Maputo" });
    const server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => server.close();
  });
  afterAll(() => close());

  const get = (path: string, headers: Record<string, string> = {}) => fetch(base + path, { headers, redirect: "manual" });
  const post = (path: string, form: Record<string, string>, headers: Record<string, string> = {}) =>
    fetch(base + path, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(form), redirect: "manual" });
  const signIn = async () => {
    const r = await post("/login", { user: "admin", password: "s3cret" });
    return { r, cookie: (r.headers.get("set-cookie") ?? "").split(";")[0] };
  };

  it("without a session, a page goes to the sign-in form and the API answers 401, with no browser prompt", async () => {
    const page = await get("/");
    expect(page.status).toBe(302);
    expect(page.headers.get("location")).toBe("/login");
    const api = await get("/api/config");
    expect(api.status).toBe(401);
    expect(api.headers.get("www-authenticate")).toBeNull();
  });

  it("the sign-in page and its logo are public", async () => {
    const page = await get("/login");
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('<form method="post" action="login">');
    expect(html).toContain('type="password"');
    expect((await get("/logo.png")).status).toBe(200);
  });

  it("a wrong password shows the form again with a message and sets no cookie", async () => {
    const r = await post("/login", { user: "admin", password: "nope" });
    expect(r.status).toBe(401);
    expect(r.headers.get("set-cookie")).toBeNull();
    const html = await r.text();
    expect(html).toContain("That username or password is not right.");
    expect(html).toContain('value="admin"'); // the username is kept
    expect(html).not.toContain("nope");
  });

  it("the right password sets an HttpOnly session cookie and opens the dashboard", async () => {
    const { r, cookie } = await signIn();
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("./");
    const set = r.headers.get("set-cookie") ?? "";
    expect(set).toContain("HttpOnly");
    expect(set).toContain("SameSite=Lax");
    expect(cookie.startsWith("grm_session=")).toBe(true);

    const page = await get("/", { Cookie: cookie });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Log out");
    expect((await get("/api/config", { Cookie: cookie })).status).toBe(200);
    expect((await get("/login", { Cookie: cookie })).status).toBe(302); // already signed in
  });

  it("an altered cookie is not accepted", async () => {
    const { cookie } = await signIn();
    expect((await get("/", { Cookie: `${cookie}x` })).status).toBe(302);
    expect((await get("/api/config", { Cookie: "grm_session=abc.123.def" })).status).toBe(401);
  });

  it("logging out clears the cookie", async () => {
    const { cookie } = await signIn();
    const r = await post("/logout", {}, { Cookie: cookie });
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("login");
    expect(r.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("a signed-in request from another site cannot change anything", async () => {
    const { cookie } = await signIn();
    const r = await fetch(`${base}/api/config`, { method: "PUT", headers: { Cookie: cookie, "Content-Type": "application/json", Origin: "https://evil.example" }, body: "{}" });
    expect(r.status).toBe(403);
    const same = await fetch(`${base}/api/config`, { method: "PUT", headers: { Cookie: cookie, "Content-Type": "application/json", Origin: base }, body: "{}" });
    expect(same.status).toBe(200);
  });

  it("scripts can still send the username and password directly", async () => {
    const basic = `Basic ${Buffer.from("admin:s3cret").toString("base64")}`;
    expect((await get("/api/config", { Authorization: basic })).status).toBe(200);
    expect((await get("/api/config", { Authorization: `Basic ${Buffer.from("admin:wrong").toString("base64")}` })).status).toBe(401);
  });

  it("repeated wrong passwords are refused for a while", async () => {
    let last = 0;
    for (let i = 0; i < 6; i++) last = (await post("/login", { user: "admin", password: `guess${i}` })).status;
    expect(last).toBe(429);
    // even the right password has to wait
    expect((await post("/login", { user: "admin", password: "s3cret" })).status).toBe(429);
  });
});
