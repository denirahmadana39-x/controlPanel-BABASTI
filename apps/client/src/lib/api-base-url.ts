type BrowserLocation = Pick<Location, "hostname" | "protocol">;

export function resolveApiBaseUrl(
  configuredUrl: string | undefined,
  location: BrowserLocation,
): string {
  const explicitUrl = configuredUrl?.trim().replace(/\/+$/, "");
  if (explicitUrl) return explicitUrl;

  const panelPrefix = "panel.";
  if (location.hostname.startsWith(panelPrefix)) {
    const domain = location.hostname.slice(panelPrefix.length);
    if (domain) return `${location.protocol}//api.${domain}/api`;
  }

  return "/api";
}
