import { AppError, ErrorCode } from "@quickstart/errors";
import type { WebFetchConfig } from "../config/environment.js";
import { DirectHttpAcquisitionProvider } from "./direct-http.provider.js";
import { FakeAcquisitionProvider } from "./fake.provider.js";
import { FirecrawlAcquisitionProvider } from "./firecrawl.provider.js";
import { OlostepAcquisitionProvider } from "./olostep.provider.js";
import { ApifyAcquisitionProvider } from "./apify.provider.js";
import type { AcquisitionProvider } from "./types.js";

export type ProviderRegistry = {
  get(profileId: string): AcquisitionProvider;
  findDriver?(driver: string): AcquisitionProvider | undefined;
  listEnabledProfiles(): AcquisitionProviderProfileView[];
};

export type AcquisitionProviderProfileView = {
  id: string;
  driver: string;
  enabled: boolean;
  priority: number;
  unitCostMicrosScrape: number;
  unitCostMicrosSearch: number;
};

export function createProviderRegistry(config: WebFetchConfig): ProviderRegistry {
  const providers = new Map<string, AcquisitionProvider>();
  const views: AcquisitionProviderProfileView[] = [];

  for (const profile of config.providerProfiles) {
    let provider: AcquisitionProvider;
    switch (profile.driver) {
      case "fake":
        provider = new FakeAcquisitionProvider(profile.id);
        break;
      case "direct_http":
        provider = new DirectHttpAcquisitionProvider(profile, config);
        break;
      case "olostep":
        provider = new OlostepAcquisitionProvider(profile, config.scrapeTimeoutMs);
        break;
      case "firecrawl":
        provider = new FirecrawlAcquisitionProvider(profile, config.scrapeTimeoutMs);
        break;
      case "apify":
        provider = new ApifyAcquisitionProvider(profile, config.scrapeTimeoutMs);
        break;
      default:
        throw new Error(`Unknown driver ${profile.driver as string} for profile ${profile.id}`);
    }
    providers.set(profile.id, provider);
    views.push({
      id: profile.id,
      driver: profile.driver,
      enabled: profile.enabled,
      priority: profile.priority,
      unitCostMicrosScrape: profile.unitCostMicrosScrape,
      unitCostMicrosSearch: profile.unitCostMicrosSearch,
    });
  }

  // Public HTTP pages should not require a paid browser actor. Respect an
  // explicitly configured/disabled direct driver, otherwise provide a safe default.
  if (!config.providerProfiles.some((profile) => profile.driver === "direct_http")) {
    const profile = { id: "direct_http_builtin", driver: "direct_http" as const, enabled: true,
      priority: -100, unitCostMicrosScrape: 0, unitCostMicrosSearch: 0 };
    providers.set(profile.id, new DirectHttpAcquisitionProvider(profile, config));
    views.push(profile);
  }

  if (!providers.has("fake")) {
    const onlyCustomProfiles =
      config.providerProfiles.length > 0 &&
      !config.providerProfiles.some((profile) => profile.id === "fake");
    if (!onlyCustomProfiles) {
      providers.set("fake", new FakeAcquisitionProvider("fake"));
      views.push({
        id: "fake",
        driver: "fake",
        enabled: true,
        priority: 0,
        unitCostMicrosScrape: 0,
        unitCostMicrosSearch: 0,
      });
    }
  }

  return {
    get(profileId: string): AcquisitionProvider {
      const provider = providers.get(profileId);
      if (!provider) {
        throw new AppError({
          code: ErrorCode.VALIDATION_FAILED,
          message: `Unknown provider profile: ${profileId}`,
        });
      }
      return provider;
    },
    findDriver(driver: string): AcquisitionProvider | undefined {
      for (const p of providers.values()) {
        if (p.driver === driver) return p;
      }
      return undefined;
    },
    listEnabledProfiles(): AcquisitionProviderProfileView[] {
      return views.filter((v) => v.enabled).sort((a, b) => a.priority - b.priority);
    },
  };
}
