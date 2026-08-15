import { loadConfig } from "@babasti/config";
import type { HostingProvider } from "./types.js";
import { MockHostingNodeProvider } from "./mock-provider.js";
import { RealHostingNodeProvider } from "./real-provider.js";

let provider: HostingProvider | null = null;

/**
 * Returns the active hosting provider. Selection is driven entirely by the
 * DEPLOYMENT_PROVIDER environment variable so the rest of the codebase never
 * branches on mock vs real. Switching providers requires no code changes
 * outside this module.
 */
export function getHostingProvider(): HostingProvider {
  if (provider) return provider;
  const config = loadConfig();
  if (config.DEPLOYMENT_PROVIDER === "real") {
    provider = new RealHostingNodeProvider();
  } else {
    provider = new MockHostingNodeProvider();
  }
  return provider;
}

export function providerName(): string {
  return getHostingProvider().name;
}

export type { HostingProvider } from "./types.js";
