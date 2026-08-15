import { api } from "@/lib/api";
import type { User, OverviewData, GithubRepo, SessionInfo } from "./types";

export const authService = {
  register: (body: { email: string; password: string; displayName: string }) =>
    api.post<User>("/auth/register", body),
  login: (body: { email: string; password: string }) =>
    api.post<User>("/auth/login", body),
  me: () => api.get<User>("/auth/me"),
  logout: () => api.post<{ success: boolean }>("/auth/logout"),
  changePassword: (body: {
    currentPassword: string;
    newPassword: string;
  }) => api.post<{ success: boolean }>("/auth/password"),
  googleUrl: () => "/api/auth/google",
};

export const userService = {
  me: () =>
    api.get<{
      id: string;
      email: string;
      displayName: string;
      role: string;
      createdAt: string;
      connectedAccounts: { provider: string; connectedAt: string }[];
      sessions: SessionInfo[];
    }>("/users/me"),
  updateProfile: (body: { displayName: string }) =>
    api.patch<User>("/users/me", body),
  listSessions: () =>
    api.get<{ items: SessionInfo[] }>("/users/sessions"),
  revokeSession: (id: string) =>
    api.delete<{ success: boolean }>(`/users/sessions/${id}`),
};

export const overviewService = {
  get: () => api.get<OverviewData>("/overview"),
};

export const githubService = {
  connectUrl: () => "/api/github/connect",
  listRepositories: () =>
    api.get<{ connected: boolean; items: GithubRepo[] }>(
      "/github/repositories",
    ),
  disconnect: () => api.delete<{ success: boolean }>("/github/disconnect"),
};
