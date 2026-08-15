export interface User {
  id: string;
  email: string;
  displayName: string;
  role: string;
  createdAt: string;
}

export interface WebsiteSummary {
  id: string;
  name: string;
  slug: string;
  description: string;
  status: string;
  defaultDomain: string;
  url: string;
  createdAt: string;
  lastDeployment: {
    id: string;
    status: string;
    releaseNumber: number | null;
    createdAt: string;
  } | null;
  deploymentsCount: number;
  domainsCount: number;
}

export interface WebsiteDetail {
  id: string;
  name: string;
  slug: string;
  description: string;
  status: string;
  defaultDomain: string;
  url: string;
  currentReleaseId: string | null;
  createdAt: string;
  updatedAt: string;
  domains: Domain[];
  deploymentsCount: number;
}

export interface Domain {
  id: string;
  domain: string;
  isDefault: boolean;
  status: string;
  verifiedAt: string | null;
  instructions?: {
    type: string;
    name: string;
    value: string;
    note?: string;
  } | null;
}

export interface Deployment {
  id: string;
  source: string;
  status: string;
  releaseNumber: number | null;
  githubRepo: string | null;
  githubBranch: string | null;
  buildCommand: string | null;
  outputDirectory: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface DeploymentLogEntry {
  id: string;
  level: string;
  message: string;
  timestamp: string;
}

export interface PagedDeployments {
  items: Deployment[];
  pagination: { page: number; limit: number; total: number };
}

export interface EnvironmentVariable {
  id: string;
  key: string;
  value: string;
  visibility: string;
}

export interface OverviewData {
  counts: { websites: number; domains: number; deployments: number };
  storage: { bytes: number; formatted: string };
  bandwidth: { bytes: number; formatted: string };
  recentDeployments: Array<{
    id: string;
    websiteName: string;
    slug: string;
    status: string;
    source: string;
    releaseNumber: number | null;
    createdAt: string;
    relative: string;
  }>;
  recentWebsites: Array<{
    name: string;
    slug: string;
    status: string;
    domain: string;
    url: string;
    relative: string;
  }>;
}

export interface GithubRepo {
  name: string;
  defaultBranch: string;
  private: boolean;
}

export interface SessionInfo {
  id: string;
  current: boolean;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  expiresAt: string;
  lastActive: string;
}

export interface ConnectedAccount {
  provider: string;
  connectedAt: string;
}
