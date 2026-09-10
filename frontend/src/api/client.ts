// Typed API client — all backend calls live here (DRY).
import type {
  User,
  CampaignRow,
  EmailRow,
  ScheduleCampaignRequest,
  ScheduleCampaignResponse,
  EmailListResponse,
  SearchResponse,
  SenderRow,
  StatsResponse,
  SlackStatusResponse,
} from "../types";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string; detail?: string };
      message = data.error ?? data.detail ?? message;
    } catch {
      /* non-JSON error */
    }
    const err = new Error(message) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

export const api = {
  auth: {
    me: () => request<{ user: User }>("/api/auth/me"),
    logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),
    googleUrl: `${API_BASE}/api/auth/google`,
  },
  campaigns: {
    list: () => request<{ campaigns: CampaignRow[] }>("/api/campaigns"),
    get: (id: string) => request<{ campaign: CampaignRow & { emails: EmailRow[] } }>(`/api/campaigns/${id}`),
    create: (body: ScheduleCampaignRequest) =>
      request<ScheduleCampaignResponse>("/api/campaigns", {
        method: "POST",
        body: JSON.stringify(body),
      }),
  },
  emails: {
    list: (params: { status?: string; page?: number; pageSize?: number; campaignId?: string }) => {
      const q = new URLSearchParams();
      if (params.status) q.set("status", params.status);
      if (params.page) q.set("page", String(params.page));
      if (params.pageSize) q.set("pageSize", String(params.pageSize));
      if (params.campaignId) q.set("campaignId", params.campaignId);
      return request<EmailListResponse>(`/api/emails?${q.toString()}`);
    },
    search: (q: string) => request<SearchResponse>(`/api/emails/search?q=${encodeURIComponent(q)}`),
  },
  senders: {
    list: () => request<{ senders: SenderRow[] }>("/api/senders"),
  },
  stats: () => request<StatsResponse>("/api/stats"),
  slack: {
    authorizeUrl: `${API_BASE}/api/slack/authorize?t=${Date.now()}`,
    status: () => request<SlackStatusResponse>("/api/slack/status"),
    disconnect: () => request<{ ok: true }>("/api/slack/disconnect", { method: "POST" }),
  },
  bullBoardUrl: `${API_BASE}/admin/queues`,
};

export type Api = typeof api;
