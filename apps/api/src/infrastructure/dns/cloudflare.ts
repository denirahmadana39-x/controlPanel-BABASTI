import { loadConfig } from "@babasti/config";
import { AppError, ErrorCode, logger } from "@babasti/shared";

interface CloudflareRecord {
  id: string;
  name: string;
  content: string;
  type: string;
  proxied?: boolean;
}

interface CloudflareEnvelope<T> {
  success: boolean;
  result: T;
  errors?: Array<{ code?: number; message?: string }>;
}

interface CloudflareDnsOptions {
  apiToken: string;
  zoneId: string;
  proxied: boolean;
  required: boolean;
}

export class CloudflareDnsProvider {
  private readonly options: CloudflareDnsOptions;

  constructor(options?: Partial<CloudflareDnsOptions>) {
    const config = loadConfig();
    this.options = {
      apiToken: options?.apiToken ?? config.CLOUDFLARE_API_TOKEN,
      zoneId: options?.zoneId ?? config.CLOUDFLARE_ZONE_ID,
      proxied: options?.proxied ?? config.CLOUDFLARE_DNS_PROXIED,
      required:
        options?.required ??
        (config.NODE_ENV === "production" &&
          config.DEPLOYMENT_PROVIDER === "real"),
    };
  }

  async ensureWebsiteRecord(
    hostname: string,
    tunnelTarget: string | null | undefined,
  ): Promise<string | null> {
    if (!tunnelTarget) {
      if (this.options.required) {
        throw new AppError(
          ErrorCode.NODE_UNAVAILABLE,
          "Selected hosting node has no Cloudflare tunnel target",
        );
      }
      logger.warn(`DNS publishing skipped for ${hostname}: node target is unset`);
      return null;
    }
    if (!this.isConfigured()) {
      if (this.options.required) {
        throw new AppError(
          ErrorCode.INTERNAL_ERROR,
          "Cloudflare DNS credentials are not configured",
        );
      }
      logger.warn(`DNS publishing skipped for ${hostname}: Cloudflare is not configured`);
      return null;
    }

    const existing = await this.findRecord(hostname);
    const body = {
      type: "CNAME",
      name: hostname,
      content: tunnelTarget,
      ttl: 1,
      proxied: this.options.proxied,
      comment: "Managed by BabaSTI Hosting",
    };
    if (existing) {
      throw new AppError(
        ErrorCode.DOMAIN_TAKEN,
        `DNS hostname ${hostname} already exists and is not managed by this website`,
      );
    }
    const record = await this.request<CloudflareRecord>("/dns_records", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return record.id;
  }

  async deleteRecord(recordId: string | null | undefined): Promise<void> {
    if (!recordId || !this.isConfigured()) return;
    await this.request<{ id: string }>(`/dns_records/${recordId}`, {
      method: "DELETE",
    });
  }

  private isConfigured(): boolean {
    return Boolean(this.options.apiToken && this.options.zoneId);
  }

  private async findRecord(hostname: string): Promise<CloudflareRecord | null> {
    const query = new URLSearchParams({
      type: "CNAME",
      "name.exact": hostname,
      match: "all",
      per_page: "1",
    });
    const records = await this.request<CloudflareRecord[]>(
      `/dns_records?${query.toString()}`,
    );
    return records[0] ?? null;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(this.options.zoneId)}${path}`,
      {
        ...init,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.options.apiToken}`,
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(15_000),
      },
    );
    const payload = (await response.json()) as CloudflareEnvelope<T>;
    if (!response.ok || !payload.success) {
      const detail = payload.errors?.map((error) => error.message).join(", ");
      throw new AppError(
        ErrorCode.INTERNAL_ERROR,
        detail ? `Cloudflare DNS request failed: ${detail}` : "Cloudflare DNS request failed",
      );
    }
    return payload.result;
  }
}

let instance: CloudflareDnsProvider | null = null;

export function getDnsProvider(): CloudflareDnsProvider {
  if (!instance) instance = new CloudflareDnsProvider();
  return instance;
}
