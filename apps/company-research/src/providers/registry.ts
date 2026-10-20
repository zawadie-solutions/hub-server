/**
 * Provider registry: the one place that knows which SearchProvider classes exist.
 *
 * To add a provider: implement it (see webSearch.ts), then add it to PROVIDER_CLASSES.
 */
import { envSet, type ProvidersConfig } from "../config";
import type { SearchProvider } from "./base";
import { MockProvider } from "./mock";
import { BingProvider, BraveProvider, GoogleProvider, SerpApiProvider } from "./webSearch";

export const PROVIDER_CLASSES: Record<string, () => SearchProvider> = {
  google: () => new GoogleProvider(),
  bing: () => new BingProvider(),
  serpapi: () => new SerpApiProvider(),
  brave: () => new BraveProvider(),
  mock: () => mockProvider,
};

// One shared mock instance so its simulated "web" stays consistent across a run.
const mockProvider = new MockProvider();

export const getProvider = (name: string): SearchProvider => PROVIDER_CLASSES[name]();

export function providerStatus(cfg: ProvidersConfig) {
  return Object.keys(PROVIDER_CLASSES).map((name) => {
    const provider = getProvider(name);
    const toggle = cfg.providers[name];
    return {
      name,
      label: provider.label,
      is_demo: provider.isDemo,
      enabled: Boolean(toggle?.enabled) || name === "mock",
      configured: provider.isConfigured(),
      required_env: [...provider.requiredEnv],
      // which keys are present — the values themselves are never sent to the browser
      env_set: Object.fromEntries(provider.requiredEnv.map((key) => [key, envSet(key)])),
    };
  });
}

/**
 * [ordered fallback chain, demo mode].
 *
 * Order: primary, secondary, then every other enabled live provider. Live and demo data are
 * never mixed: the mock provider is used only when it is the selected primary provider or when
 * no live provider has credentials (Demo Mode).
 */
export function buildChain(cfg: ProvidersConfig): [SearchProvider[], boolean] {
  if (cfg.default_provider === "mock") return [[mockProvider], true];
  const order = [cfg.default_provider, cfg.secondary_provider, ...Object.entries(cfg.providers).filter(([, t]) => t.enabled).map(([n]) => n)];
  const chain: SearchProvider[] = [];
  for (const name of order) {
    if (!name || name === "mock" || !(name in PROVIDER_CLASSES)) continue;
    if (chain.some((p) => p.name === name)) continue;
    const provider = getProvider(name);
    if (provider.isConfigured()) chain.push(provider);
  }
  if (!chain.length) return [[mockProvider], true];
  return [chain, false];
}
