import { useCallback, useEffect, useRef, useState } from "react";

const STATUS_CLASS: Record<string, string> = {
  VERIFIED: "good", COMPLETED: "good", CONFIRMED: "good", MANUAL: "good", PROVIDED: "good",
  LIKELY: "ok", RESEARCHING: "info",
  UNCERTAIN: "warn", NEEDS_REVIEW: "warn",
  CONFLICT: "bad", FAILED: "bad",
  NOT_FOUND: "muted", PENDING: "muted",
};

const STATUS_LABEL: Record<string, string> = { NEEDS_REVIEW: "Review", NOT_FOUND: "Not found" };

export function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="muted">—</span>;
  const label = STATUS_LABEL[status] ?? status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " ");
  return <span className={`badge ${STATUS_CLASS[status] ?? "muted"}`}>{label}</span>;
}

export function DemoTag() {
  return <span className="badge demo" title="Simulated data — not real research">DEMO DATA</span>;
}

export function Confidence({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined || value === 0) return <span className="muted">—</span>;
  const level = value >= 85 ? "good" : value >= 65 ? "ok" : value >= 40 ? "warn" : "bad";
  return <span className={`confidence ${level}`}>{Math.round(value)}%</span>;
}

export function Found({ value }: { value: string | null | undefined }) {
  return value ? <span className="found">Found</span> : <span className="muted">Not found</span>;
}

export function ErrorBox({ message }: { message: string | null }) {
  return message ? <div className="alert error">{message}</div> : null;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value.endsWith("Z") || value.includes("+") ? value : `${value}Z`);
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Load data now and (optionally) keep refreshing it every `intervalMs`. */
export function usePolling<T>(loader: () => Promise<T>, intervalMs = 0, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const reload = useCallback(async () => {
    try {
      setData(await loaderRef.current());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    reload();
    if (!intervalMs) return;
    const timer = window.setInterval(reload, intervalMs);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, intervalMs, ...deps]);

  return { data, error, reload, setData };
}
