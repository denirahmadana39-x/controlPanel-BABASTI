/**
 * Canonical domain enums and shared value types for the BabaSTI Hosting platform.
 * These are intentionally free of Prisma/runtime dependencies so both the
 * client and server can import them safely.
 */

export const UserRole = {
  USER: "USER",
  ADMIN: "ADMIN",
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const WebsiteStatus = {
  ONLINE: "ONLINE",
  DEPLOYING: "DEPLOYING",
  FAILED: "FAILED",
  OFFLINE: "OFFLINE",
} as const;
export type WebsiteStatus = (typeof WebsiteStatus)[keyof typeof WebsiteStatus];

export const DeploymentStatus = {
  QUEUED: "QUEUED",
  PREPARING: "PREPARING",
  UPLOADING: "UPLOADING",
  CLONING: "CLONING",
  INSTALLING: "INSTALLING",
  BUILDING: "BUILDING",
  PUBLISHING: "PUBLISHING",
  CONFIGURING: "CONFIGURING",
  HEALTH_CHECK: "HEALTH_CHECK",
  SUCCESS: "SUCCESS",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
} as const;
export type DeploymentStatus =
  (typeof DeploymentStatus)[keyof typeof DeploymentStatus];

export const TerminalDeploymentStatuses: DeploymentStatus[] = [
  DeploymentStatus.SUCCESS,
  DeploymentStatus.FAILED,
  DeploymentStatus.CANCELLED,
];

export const NodeStatus = {
  ONLINE: "ONLINE",
  OFFLINE: "OFFLINE",
  DRAINING: "DRAINING",
} as const;
export type NodeStatus = (typeof NodeStatus)[keyof typeof NodeStatus];

export const DeploymentSource = {
  ZIP: "ZIP",
  GITHUB: "GITHUB",
} as const;
export type DeploymentSource =
  (typeof DeploymentSource)[keyof typeof DeploymentSource];

export const DomainStatus = {
  PENDING: "PENDING",
  ACTIVE: "ACTIVE",
  FAILED: "FAILED",
} as const;
export type DomainStatus = (typeof DomainStatus)[keyof typeof DomainStatus];

export const EnvironmentVariableVisibility = {
  PUBLIC: "PUBLIC",
  SECRET: "SECRET",
} as const;
export type EnvironmentVariableVisibility =
  (typeof EnvironmentVariableVisibility)[keyof typeof EnvironmentVariableVisibility];

export const DeploymentLogLevel = {
  INFO: "INFO",
  WARN: "WARN",
  ERROR: "ERROR",
} as const;
export type DeploymentLogLevel =
  (typeof DeploymentLogLevel)[keyof typeof DeploymentLogLevel];

/** Reserved slugs that may never be used as a website subdomain. */
export const RESERVED_SLUGS: readonly string[] = [
  "admin",
  "api",
  "panel",
  "www",
  "mail",
  "ftp",
  "ns1",
  "ns2",
  "cdn",
  "status",
  "blog",
  "docs",
  "app",
  "auth",
  "static",
  "assets",
  "dev",
  "staging",
];

/** Slug validation rules shared by client and server. */
export const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;
export const MAX_SLUG_LENGTH = 63;

export interface HostingNodeInfo {
  id: string;
  name: string;
  status: NodeStatus;
}

export interface DeploymentLogEntry {
  timestamp: string;
  level: DeploymentLogLevel;
  message: string;
}

export interface WebsiteUsage {
  storageBytes: number;
  bandwidthBytes: number;
  deploymentsCount: number;
}
