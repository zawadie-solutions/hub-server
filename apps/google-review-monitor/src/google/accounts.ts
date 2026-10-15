import { config } from "../config";
import { basicToken } from "./dataForSeoChecker";

/** Where a paid review source's account stands, for the Configure page. */
export interface AccountStatus {
  service: string;
  /** False when its credentials are not in .env. */
  configured: boolean;
  /** One line a person can read, e.g. "$12.40 balance" or the error. */
  detail: string;
  /** True when it cannot pay for more checks: no credit left, or the lookup failed. */
  attention: boolean;
}

const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;

export async function dataForSeoAccount(fetchImpl: typeof fetch = fetch): Promise<AccountStatus> {
  const service = "DataForSEO";
  let d: ReturnType<typeof config.dataforseo>;
  try {
    d = config.dataforseo();
  } catch {
    return { service, configured: false, detail: "Login not set in .env", attention: false };
  }
  try {
    const res = await fetchImpl("https://api.dataforseo.com/v3/appendix/user_data", { headers: { Authorization: `Basic ${basicToken(d.login, d.password)}` } });
    const j = (await res.json()) as { status_message?: string; tasks?: { result?: { money?: { balance?: number } }[] }[] };
    const balance = j.tasks?.[0]?.result?.[0]?.money?.balance;
    if (!res.ok || typeof balance !== "number") return { service, configured: true, detail: `Could not read the balance: ${j.status_message ?? `HTTP ${res.status}`}`, attention: true };
    return { service, configured: true, detail: `${money(balance)} balance${balance <= 0 ? " — top up before the next check" : ""}`, attention: balance <= 0 };
  } catch (e) {
    return { service, configured: true, detail: `Could not read the balance: ${(e as Error).message}`, attention: true };
  }
}

export async function apifyAccount(fetchImpl: typeof fetch = fetch): Promise<AccountStatus> {
  const service = "Apify";
  let a: ReturnType<typeof config.apify>;
  try {
    a = config.apify();
  } catch {
    return { service, configured: false, detail: "Token not set in .env", attention: false };
  }
  try {
    const res = await fetchImpl("https://api.apify.com/v2/users/me/limits", { headers: { Authorization: `Bearer ${a.token}` } });
    const j = (await res.json()) as { data?: { limits?: { maxMonthlyUsageUsd?: number }; current?: { monthlyUsageUsd?: number } } };
    const used = j.data?.current?.monthlyUsageUsd;
    const limit = j.data?.limits?.maxMonthlyUsageUsd;
    if (!res.ok || typeof used !== "number" || typeof limit !== "number") return { service, configured: true, detail: `Could not read the usage (HTTP ${res.status})`, attention: true };
    const out = used >= limit;
    return { service, configured: true, detail: `${money(used)} used of ${money(limit)} this month${out ? " — no credit left" : ""}`, attention: out };
  } catch (e) {
    return { service, configured: true, detail: `Could not read the usage: ${(e as Error).message}`, attention: true };
  }
}
