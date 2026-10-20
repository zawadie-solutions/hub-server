/** HTTP plumbing: FastAPI-compatible error bodies ({detail}), validation and async routes. */
import type express from "express";
import { type ZodError, type ZodType, type z } from "zod";

/** An error with a status code; `detail` is what the browser sees (FastAPI's shape). */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly detail: unknown,
  ) {
    super(typeof detail === "string" ? detail : `HTTP ${status}`);
  }
}

/** FastAPI's 422 body: [{loc: ["body", ...path], msg, type}]. */
function validationDetail(error: ZodError, where: string) {
  return error.issues.map((issue) => ({ loc: [where, ...issue.path], msg: issue.message, type: issue.code }));
}

export function parseBody<S extends ZodType>(schema: S, body: unknown): z.infer<S> {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(422, validationDetail(parsed.error, "body"));
  return parsed.data;
}

/** An integer query parameter (422 when present but not a whole number). */
export function intQuery(req: express.Request, name: string, fallback: number | null): number | null {
  const raw = req.query[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new HttpError(422, [{ loc: ["query", name], msg: "Input should be a valid integer", type: "int_parsing" }]);
  return n;
}

export const strQuery = (req: express.Request, name: string, fallback = "") => (typeof req.query[name] === "string" ? (req.query[name] as string) : fallback);

export function intParam(req: express.Request, name: string): number {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n)) throw new HttpError(422, [{ loc: ["path", name], msg: "Input should be a valid integer", type: "int_parsing" }]);
  return n;
}

/** Wraps an async handler so its result is sent as JSON and a thrown error reaches the error handler. */
export const route =
  (fn: (req: express.Request, res: express.Response) => Promise<unknown> | unknown): express.RequestHandler =>
  (req, res, next) => {
    Promise.resolve()
      .then(() => fn(req, res))
      .then((out) => {
        if (out !== undefined && !res.headersSent) res.json(out);
      })
      .catch(next);
  };
