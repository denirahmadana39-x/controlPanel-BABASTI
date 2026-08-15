import { api } from "@/lib/api";
import type { WebsiteSummary, WebsiteDetail, Domain } from "./types";

export const websitesService = {
  list: () => api.get<WebsiteSummary[]>("/websites"),
  get: (id: string) => api.get<WebsiteDetail>(`/websites/${id}`),
  create: (body: { name: string; slug: string; description?: string }) =>
    api.post<WebsiteSummary>("/websites", body),
  update: (id: string, body: { name?: string; description?: string }) =>
    api.patch<WebsiteSummary>(`/websites/${id}`, body),
  remove: (id: string) => api.delete<{ success: boolean }>(`/websites/${id}`),
  suggestSlug: (name?: string) =>
    api.get<{ slug: string }>("/websites/suggest-slug", { query: { name } }),
};

export const domainsService = {
  list: (websiteId: string) =>
    api.get<{ items: Domain[] }>(`/websites/${websiteId}/domains`),
  add: (websiteId: string, domain: string) =>
    api.post<Domain>(`/websites/${websiteId}/domains`, { domain }),
  remove: (websiteId: string, domainId: string) =>
    api.delete<{ success: boolean }>(
      `/websites/${websiteId}/domains/${domainId}`,
    ),
};

export const environmentService = {
  list: (websiteId: string) =>
    api.get<{ items: EnvVar[] }>(`/websites/${websiteId}/environment`),
  replace: (
    websiteId: string,
    variables: { key: string; value: string; visibility: string }[],
  ) =>
    api.put<{ items: EnvVar[] }>(`/websites/${websiteId}/environment`, {
      variables,
    }),
};

export interface EnvVar {
  id: string;
  key: string;
  value: string;
  visibility: string;
}
