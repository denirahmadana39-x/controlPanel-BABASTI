import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 5000,
    },
  },
});

export const queryKeys = {
  me: ["me"] as const,
  overview: ["overview"] as const,
  websites: ["websites"] as const,
  website: (id: string) => ["websites", id] as const,
  deployments: (websiteId: string) => ["deployments", websiteId] as const,
  deploymentLogs: (id: string) => ["deployment-logs", id] as const,
  domains: (websiteId: string) => ["domains", websiteId] as const,
  environment: (websiteId: string) => ["environment", websiteId] as const,
  githubRepos: ["github", "repos"] as const,
  userProfile: ["user", "profile"] as const,
  sessions: ["user", "sessions"] as const,
};
