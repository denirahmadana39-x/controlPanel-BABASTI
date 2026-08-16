import { z } from "zod";

/**
 * Environment configuration loader.
 *
 * The same schema is loaded by both the API (control plane) and the Node Agent,
 * though each only reads the subset it needs. Validation fails fast on boot so
 * misconfiguration is caught immediately instead of at request time.
 */

const rawBoolean = z
  .string()
  .optional()
  .transform((value) => value === "true" || value === "1");

const configSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  API_HOST: z.string().default("0.0.0.0"),
  CLIENT_URL: z.string().url().default("http://localhost:5173"),

  SESSION_SECRET: z.string().min(16, "SESSION_SECRET must be at least 16 characters"),
  SESSION_TTL: z.coerce.number().int().min(60).default(604800),
  COOKIE_SECURE: rawBoolean.default("false"),

  GOOGLE_CLIENT_ID: z.string().optional().default(""),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(""),
  GOOGLE_CALLBACK_URL: z.string().url().optional().default(""),

  GITHUB_CLIENT_ID: z.string().optional().default(""),
  GITHUB_CLIENT_SECRET: z.string().optional().default(""),
  GITHUB_CALLBACK_URL: z.string().url().optional().default(""),

  DEPLOYMENT_PROVIDER: z.enum(["mock", "real"]).default("mock"),

  NODE_AGENT_URL: z.string().optional().default(""),
  NODE_AGENT_TOKEN: z.string().optional().default(""),
  // Bootstrap credential used only for node registration. When omitted,
  // NODE_AGENT_TOKEN remains supported for backwards-compatible single-node
  // installations.
  NODE_REGISTRATION_TOKEN: z.string().optional().default(""),
  NODE_HEARTBEAT_INTERVAL_SECONDS: z.coerce.number().int().min(5).default(30),
  NODE_HEARTBEAT_TTL_SECONDS: z.coerce.number().int().min(15).default(90),

  // URL the Node Agent uses to reach the control plane (for artifact download).
  CONTROL_PLANE_URL: z.string().optional().default(""),

  STORAGE_PATH: z.string().default("./data/storage"),
  REDIS_URL: z.string().optional().default(""),

  MAX_WEBSITES_PER_USER: z.coerce.number().int().min(1).default(3),
  MAX_DEPLOYMENTS_PER_DAY: z.coerce.number().int().min(1).default(10),
  MAX_CONCURRENT_DEPLOYMENTS_PER_USER: z.coerce.number().int().min(1).default(1),
  MAX_UPLOAD_BYTES: z.coerce.number().int().min(1024).default(50 * 1024 * 1024),
  MAX_EXTRACTED_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .default(250 * 1024 * 1024),

  // Optional separate storage root for the Node Agent. When unset the agent
  // falls back to STORAGE_PATH.
  AGENT_STORAGE: z.string().optional().default(""),
  // Directory included by the node's main nginx configuration, typically
  // /etc/nginx/conf.d. Production real-provider deployments require it.
  AGENT_NGINX_CONFIG_DIR: z.string().optional().default(""),
  AGENT_NGINX_BINARY: z.string().default("nginx"),

  DEFAULT_DOMAIN_SUFFIX: z.string().default("babasti.my.id"),

  CLOUDFLARE_API_TOKEN: z.string().optional().default(""),
  CLOUDFLARE_ZONE_ID: z.string().optional().default(""),
  CLOUDFLARE_DNS_PROXIED: rawBoolean.default("true"),
  CLOUDFLARE_ACCESS_CLIENT_ID: z.string().optional().default(""),
  CLOUDFLARE_ACCESS_CLIENT_SECRET: z.string().optional().default(""),
});

export type AppConfig = z.infer<typeof configSchema> & {
  agentStoragePath: string;
  nodeRegistrationToken: string;
};

let cached: AppConfig | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached && env === process.env) {
    return cached;
  }
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const data = parsed.data;
  cached = {
    ...data,
    agentStoragePath: data.AGENT_STORAGE || data.STORAGE_PATH,
    nodeRegistrationToken:
      data.NODE_REGISTRATION_TOKEN || data.NODE_AGENT_TOKEN,
  } as AppConfig;
  return cached;
}

export function isProduction(config: AppConfig): boolean {
  return config.NODE_ENV === "production";
}

export function isTest(config: AppConfig): boolean {
  return config.NODE_ENV === "test";
}

export function defaultWebsiteDomain(slug: string, config: AppConfig): string {
  return `${slug}.${config.DEFAULT_DOMAIN_SUFFIX}`;
}
