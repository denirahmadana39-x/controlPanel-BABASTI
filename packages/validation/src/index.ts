import { z } from "zod";
import {
  RESERVED_SLUGS,
  SLUG_REGEX,
  DeploymentSource,
  EnvironmentVariableVisibility,
} from "@babasti/types";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Invalid email address")
  .max(254, "Email too long");

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password too long");

export const slugSchema = z
  .string()
  .trim()
  .min(2, "Name must be at least 2 characters")
  .max(63, "Name too long")
  .regex(
    SLUG_REGEX,
    "Use lowercase letters, numbers and hyphens only (e.g. my-project)",
  )
  .refine((value) => !RESERVED_SLUGS.includes(value), {
    message: "This name is reserved and cannot be used",
  });

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Display name is required")
  .max(80, "Display name too long");

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const updateProfileSchema = z.object({
  displayName: displayNameSchema,
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const createWebsiteSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(80),
  slug: slugSchema,
  description: z.string().trim().max(500).optional().default(""),
});
export type CreateWebsiteInput = z.infer<typeof createWebsiteSchema>;

export const updateWebsiteSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(500).optional(),
});
export type UpdateWebsiteInput = z.infer<typeof updateWebsiteSchema>;

export const githubDeployConfigSchema = z.object({
  repository: z.string().trim().min(1, "Repository is required"),
  branch: z.string().trim().min(1, "Branch is required").default("main"),
  installCommand: z.string().trim().max(200).optional().default("npm install"),
  buildCommand: z.string().trim().max(200).optional().default("npm run build"),
  outputDirectory: z.string().trim().max(200).optional().default("dist"),
});
export type GithubDeployConfig = z.infer<typeof githubDeployConfigSchema>;

export const zipDeploySchema = z.object({
  // Additional build configuration for ZIP deployments (optional).
  installCommand: z.string().trim().max(200).optional(),
  buildCommand: z.string().trim().max(200).optional(),
  outputDirectory: z.string().trim().max(200).optional(),
});
export type ZipDeployConfig = z.infer<typeof zipDeploySchema>;

export const createDeploymentSchema = z.object({
  source: z.enum(["ZIP", "GITHUB"]),
  githubConfig: githubDeployConfigSchema.optional(),
  zipConfig: zipDeploySchema.optional(),
});
export type CreateDeploymentInput = z.infer<typeof createDeploymentSchema>;

export const domainSchema = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i,
      "Enter a valid domain (e.g. www.example.com)",
    )
    .max(253, "Domain too long"),
});
export type DomainInput = z.infer<typeof domainSchema>;

export const environmentVariableSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(
      /^[A-Za-z_][A-Za-z0-9_]*$/,
      "Key must be alphanumeric/underscore and start with a letter or underscore",
    )
    .max(120),
  value: z.string().max(4096),
  visibility: z.enum(["PUBLIC", "SECRET"]).default("SECRET"),
});
export type EnvironmentVariableInput = z.infer<typeof environmentVariableSchema>;

export const replaceEnvironmentSchema = z.object({
  variables: z.array(environmentVariableSchema).max(200),
});
export type ReplaceEnvironmentInput = z.infer<typeof replaceEnvironmentSchema>;

export const githubConnectSchema = z.object({
  code: z.string().min(1, "Authorization code is required"),
  state: z.string().min(1, "State is required"),
});
export type GithubConnectInput = z.infer<typeof githubConnectSchema>;

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationInput = z.infer<typeof paginationSchema>;
