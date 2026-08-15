import { api } from "@/lib/api";
import type { Deployment, DeploymentLogEntry, PagedDeployments } from "./types";

export const deploymentsService = {
  list: (websiteId: string, page = 1, limit = 20) =>
    api.get<PagedDeployments>(`/websites/${websiteId}/deployments`, {
      query: { page, limit },
    }),
  get: (id: string) => api.get<Deployment>(`/deployments/${id}`),
  logs: (id: string) =>
    api.get<{ items: DeploymentLogEntry[] }>(`/deployments/${id}/logs`),
  cancel: (id: string) =>
    api.post<{ success: boolean }>(`/deployments/${id}/cancel`),
  rollback: (id: string) =>
    api.post<{ success: boolean; status: string }>(`/deployments/${id}/rollback`),

  // ZIP upload (multipart). buildConfig is optional.
  deployZip: async (
    websiteId: string,
    file: File,
    buildConfig?: { installCommand?: string; buildCommand?: string; outputDirectory?: string },
  ) => {
    const form = new FormData();
    form.append("file", file);
    if (buildConfig?.installCommand)
      form.append("installCommand", buildConfig.installCommand);
    if (buildConfig?.buildCommand)
      form.append("buildCommand", buildConfig.buildCommand);
    if (buildConfig?.outputDirectory)
      form.append("outputDirectory", buildConfig.outputDirectory);
    return api.post<{ id: string; status: string }>(
      `/websites/${websiteId}/deployments`,
      undefined,
      { formData: form, method: "POST" },
    );
  },

  deployGithub: (
    websiteId: string,
    githubConfig: {
      repository: string;
      branch: string;
      installCommand?: string;
      buildCommand?: string;
      outputDirectory?: string;
    },
  ) =>
    api.post<{ id: string; status: string }>(
      `/websites/${websiteId}/deployments`,
      { source: "GITHUB", githubConfig },
    ),
};
