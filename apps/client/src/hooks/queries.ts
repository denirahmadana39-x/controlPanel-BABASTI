import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  websitesService,
  domainsService,
  environmentService,
} from "@/services/websites";
import { deploymentsService } from "@/services/deployments";
import { githubService } from "@/services/auth";
import { userService, overviewService } from "@/services/auth";
import { queryKeys } from "@/lib/queryClient";
import type { EnvVar } from "@/services/websites";

export function useWebsites() {
  return useQuery({ queryKey: queryKeys.websites, queryFn: websitesService.list });
}

export function useWebsite(id: string) {
  return useQuery({
    queryKey: queryKeys.website(id),
    queryFn: () => websitesService.get(id),
    enabled: !!id,
  });
}

export function useCreateWebsite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: websitesService.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.websites }),
  });
}

export function useDeleteWebsite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) => websitesService.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.websites }),
  });
}

export function useDeployments(websiteId: string, page = 1) {
  return useQuery({
    queryKey: [...queryKeys.deployments(websiteId), page],
    queryFn: () => deploymentsService.list(websiteId, page),
    enabled: !!websiteId,
    refetchInterval: (query) => {
      const data = query.state.data;
      const active = data?.items.some(
        (d) =>
          d.status !== "SUCCESS" &&
          d.status !== "FAILED" &&
          d.status !== "CANCELLED",
      );
      return active ? 3000 : false;
    },
  });
}

export function useDeploymentLogs(id: string) {
  return useQuery({
    queryKey: queryKeys.deploymentLogs(id),
    queryFn: () => deploymentsService.logs(id),
    enabled: !!id,
    refetchInterval: 3000,
  });
}

export function useCancelDeployment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deploymentsService.cancel(id),
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useRollback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deploymentsService.rollback(id),
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useDomains(websiteId: string) {
  return useQuery({
    queryKey: queryKeys.domains(websiteId),
    queryFn: () => domainsService.list(websiteId),
    enabled: !!websiteId,
  });
}

export function useAddDomain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ websiteId, domain }: { websiteId: string; domain: string }) =>
      domainsService.add(websiteId, domain),
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: queryKeys.domains(vars.websiteId) }),
  });
}

export function useRemoveDomain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ websiteId, domainId }: { websiteId: string; domainId: string }) =>
      domainsService.remove(websiteId, domainId),
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: queryKeys.domains(vars.websiteId) }),
  });
}

export function useEnvironment(websiteId: string) {
  return useQuery({
    queryKey: queryKeys.environment(websiteId),
    queryFn: () => environmentService.list(websiteId),
    enabled: !!websiteId,
  });
}

export function useReplaceEnvironment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      websiteId,
      variables,
    }: {
      websiteId: string;
      variables: EnvVar[] | { key: string; value: string; visibility: string }[];
    }) => environmentService.replace(websiteId, variables as any),
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: queryKeys.environment(vars.websiteId) }),
  });
}

export function useGithubRepositories() {
  return useQuery({
    queryKey: queryKeys.githubRepos,
    queryFn: githubService.listRepositories,
  });
}

export function useOverview() {
  return useQuery({
    queryKey: queryKeys.overview,
    queryFn: overviewService.get,
  });
}

export function useUserProfile() {
  return useQuery({
    queryKey: queryKeys.userProfile,
    queryFn: userService.me,
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: userService.updateProfile,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.userProfile }),
  });
}

export function useSessions() {
  return useQuery({
    queryKey: queryKeys.sessions,
    queryFn: userService.listSessions,
  });
}

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => userService.revokeSession(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.sessions }),
  });
}
