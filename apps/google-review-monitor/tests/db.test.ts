import { describe, expect, it } from "vitest";
import { parseMysqlUrl, positional } from "../src/db/db";
import { makeRepo, review } from "./helpers";

describe("MySQL adapter", () => {
  it("rewrites numbered placeholders into positional ones, in order of appearance", () => {
    expect(positional("UPDATE t SET a=$2, b=$3 WHERE id=$1", [7, "x", "y"])).toEqual({ sql: "UPDATE t SET a=?, b=? WHERE id=?", values: ["x", "y", 7] });
    // a value used twice is passed twice
    expect(positional("INSERT INTO t (k, v) VALUES ($1,$2) ON DUPLICATE KEY UPDATE v = $2", ["k", "v"])).toEqual({
      sql: "INSERT INTO t (k, v) VALUES (?,?) ON DUPLICATE KEY UPDATE v = ?",
      values: ["k", "v", "v"],
    });
    expect(positional("SELECT 1")).toEqual({ sql: "SELECT 1", values: [] });
    expect(() => positional("SELECT $2", ["only one"])).toThrow("$2");
  });

  it("parses a mysql:// URL and refuses anything else", () => {
    expect(parseMysqlUrl("mysql://app:p%23ss@db.example.com:3307/reviews")).toEqual({ host: "db.example.com", port: 3307, user: "app", password: "p#ss", database: "reviews" });
    expect(parseMysqlUrl("mysql://root@localhost/reviews").port).toBe(3306);
    expect(() => parseMysqlUrl("http://u:p@localhost:3306/reviews")).toThrow("must start with mysql://");
    expect(() => parseMysqlUrl("mysql://root@localhost")).toThrow("no database name");
  });

  it("round-trips booleans, UTC times and exact text through a real table", async () => {
    const { repo, db } = await makeRepo();
    await repo.upsertDiscovered(review({ asanaTaskId: "a", location: "Café Zoë " }));
    await repo.upsertDiscovered(review({ asanaTaskId: "b", location: "cafe zoe" }));
    const [row] = await repo.all();
    expect(row.notification_sent).toBe(false);
    expect(row.monitoring_active).toBe(true);
    expect(row.created_at).toBeInstanceOf(Date);
    expect(Math.abs(row.created_at.getTime() - Date.now())).toBeLessThan(60_000); // stored and read back as UTC
    // case, accents and trailing spaces all count
    expect((await repo.locations()).map((l) => l.location).sort()).toEqual(["Café Zoë ", "cafe zoe"]);
    expect((await repo.reviewsByLocation({ location: "Café Zoë " })).length).toBe(1);
    expect((await repo.reviewsByLocation({ location: "Café Zoë" })).length).toBe(0);
    // an UPDATE that matches a row but changes nothing still counts as matched
    const r = await db.query("UPDATE reviews SET rating = rating WHERE asana_task_id = $1", ["a"]);
    expect(r.rowCount).toBe(1);
  });
});
