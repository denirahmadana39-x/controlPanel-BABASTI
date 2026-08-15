import { loadConfig } from "@babasti/config";

const AUTH_ENDPOINT = "https://github.com/login/oauth/authorize";
const TOKEN_ENDPOINT = "https://github.com/login/oauth/access_token";

export interface GitHubUserInfo {
  id: number;
  login: string;
  name?: string;
  email?: string;
  avatar_url?: string;
}

export function isGitHubConfigured(): boolean {
  const config = loadConfig();
  return Boolean(
    config.GITHUB_CLIENT_ID &&
      config.GITHUB_CLIENT_SECRET &&
      config.GITHUB_CALLBACK_URL,
  );
}

export function getGitHubAuthUrl(state: string, purpose: "login" | "connect" = "connect"): string {
  const config = loadConfig();
  const params = new URLSearchParams({
    client_id: config.GITHUB_CLIENT_ID,
    redirect_uri: config.GITHUB_CALLBACK_URL,
    scope: "repo user:email",
    state: `${purpose}:${state}`,
    allow_signup: "true",
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export async function exchangeGitHubCode(code: string): Promise<string> {
  const config = loadConfig();
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      code,
      client_id: config.GITHUB_CLIENT_ID,
      client_secret: config.GITHUB_CLIENT_SECRET,
      redirect_uri: config.GITHUB_CALLBACK_URL,
    }),
  });
  if (!res.ok) {
    throw new Error(`GitHub token exchange failed: ${res.status}`);
  }
  const data = (await res.json()) as { access_token?: string; error?: string };
  if (!data.access_token) {
    throw new Error(data.error ?? "GitHub token exchange failed");
  }
  return data.access_token;
}

export async function fetchGitHubUser(
  accessToken: string,
): Promise<GitHubUserInfo> {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/vnd.github+json",
      "user-agent": "BabaSTI-Hosting",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub user fetch failed: ${res.status}`);
  }
  return (await res.json()) as GitHubUserInfo;
}

export async function listGitHubRepositories(
  accessToken: string,
): Promise<{ name: string; defaultBranch: string; private: boolean }[]> {
  const repos: { name: string; defaultBranch: string; private: boolean }[] = [];
  let page = 1;
  while (page <= 5) {
    const res = await fetch(
      `https://api.github.com/user/repos?per_page=100&page=${page}&affiliation=owner`,
      {
        headers: {
          authorization: `Bearer ${accessToken}`,
          accept: "application/vnd.github+json",
          "user-agent": "BabaSTI-Hosting",
        },
      },
    );
    if (!res.ok) break;
    const data = (await res.json()) as Array<{
      full_name: string;
      default_branch: string;
      private: boolean;
    }>;
    if (data.length === 0) break;
    for (const repo of data) {
      repos.push({
        name: repo.full_name,
        defaultBranch: repo.default_branch,
        private: repo.private,
      });
    }
    page += 1;
  }
  return repos;
}
