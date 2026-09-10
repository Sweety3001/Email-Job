import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../hooks/useAuth";
import { usePolling } from "../hooks/usePolling";
import { Button } from "../components/Button";
import { ComposeModal } from "../components/ComposeModal";
import { EmptyState, ErrorState, StatusBadge, Table, TableSkeleton, type Column } from "../components/Table";
import { Tabs } from "../components/Tabs";
import { useToast } from "../components/Toast";
import type { EmailRow, StatsResponse } from "../types";
import { formatDateTime } from "../lib/format";

type TabKey = "scheduled" | "sent" | "search";

function SlackChip() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [teamName, setTeamName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    api.slack
      .status()
      .then((s) => {
        setConnected(s.connected);
        setTeamName(s.teamName);
      })
      .catch(() => setConnected(null));
  }, []);

  // React to ?slack=connected / ?slack=denied query params after OAuth redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const slackParam = params.get("slack");
    if (slackParam) {
      if (slackParam === "connected") toast("Slack connected — you'll be notified when a rate limit is hit", "success");
      else if (slackParam === "denied") toast("Slack connection was denied", "error");
      else toast(`Slack connection failed (${slackParam})`, "error");
      window.history.replaceState({}, "", window.location.pathname);
      api.slack
        .status()
        .then((s) => {
          setConnected(s.connected);
          setTeamName(s.teamName);
        })
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const disconnect = async () => {
    setBusy(true);
    try {
      await api.slack.disconnect();
      setConnected(false);
      setTeamName(null);
      toast("Slack disconnected", "info");
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  if (connected === null) return null;

  return (
    <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm shadow-sm">
      <span>{connected ? "💬" : "🔕"}</span>
      {connected ? (
        <>
          <span className="font-medium text-gray-700">Slack{teamName ? ` · ${teamName}` : ""}</span>
          <button onClick={disconnect} disabled={busy} className="text-xs font-medium text-gray-400 hover:text-red-600 disabled:opacity-50">
            Disconnect
          </button>
        </>
      ) : (
        <a href={api.slack.authorizeUrl} className="font-medium text-brand-600 hover:text-brand-700">
          Connect Slack
        </a>
      )}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${accent ?? "text-gray-900"}`}>{value}</p>
    </div>
  );
}

export default function Dashboard() {
  const { user, loading: authLoading, logout } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabKey>("scheduled");
  const [composeOpen, setComposeOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Awaited<ReturnType<typeof api.emails.search>>["results"] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const stats = usePolling<StatsResponse>(() => api.stats(), 5000);
  const scheduled = usePolling(() => api.emails.list({ status: "scheduled", pageSize: 50 }), 5000);
  const sending = usePolling(() => api.emails.list({ status: "sending", pageSize: 50 }), 5000);
  const sent = usePolling(() => api.emails.list({ status: "sent", pageSize: 50 }), 5000);
  const failed = usePolling(() => api.emails.list({ status: "failed", pageSize: 50 }), 5000);

  useEffect(() => {
    if (!authLoading && !user) navigate("/login", { replace: true });
  }, [authLoading, user, navigate]);

  const runSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    try {
      const res = await api.emails.search(q);
      setSearchResults(res.results);
    } catch (err) {
      setSearchResults(null);
      setSearchError((err as Error).message);
    } finally {
      setSearching(false);
    }
  };

  const scheduledRows = [...(scheduled.data?.emails ?? []), ...(sending.data?.emails ?? [])].sort(
    (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
  );

  const scheduledColumns: Column<EmailRow>[] = [
    {
      key: "recipient",
      header: "Email",
      render: (r) => <span className="font-medium text-gray-900">{r.recipient}</span>,
    },
    { key: "subject", header: "Subject", render: (r) => <span className="text-gray-600">{r.subject}</span> },
    { key: "scheduledAt", header: "Scheduled Time", render: (r) => formatDateTime(r.scheduledAt) },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
  ];

  const sentColumns: Column<EmailRow>[] = [
    {
      key: "recipient",
      header: "Email",
      render: (r) => <span className="font-medium text-gray-900">{r.recipient}</span>,
    },
    { key: "subject", header: "Subject", render: (r) => <span className="text-gray-600">{r.subject}</span> },
    { key: "sentAt", header: "Sent Time", render: (r) => formatDateTime(r.sentAt) },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    {
      key: "preview",
      header: "Preview",
      render: (r) =>
        r.previewUrl ? (
          <a href={r.previewUrl} target="_blank" rel="noreferrer" className="font-medium text-brand-600 hover:text-brand-700">
            View in Ethereal ↗
          </a>
        ) : (
          <span className="text-gray-400">—</span>
        ),
    },
  ];

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
      </div>
    );
  }

  const failedCount = failed.data?.total ?? 0;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">📬</span>
            <span className="font-bold tracking-tight text-gray-900">ReachInbox</span>
            <span className="rounded-md bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-700">Scheduler</span>
          </div>
          <div className="flex items-center gap-3">
            <SlackChip />
            <a
              href={api.bullBoardUrl}
              target="_blank"
              rel="noreferrer"
              className="hidden rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 shadow-sm hover:text-gray-900 sm:block"
            >
              📊 Queue board
            </a>
            <div className="flex items-center gap-2.5 border-l border-gray-200 pl-3">
              <div className="hidden text-right sm:block">
                <p className="text-sm font-semibold leading-tight text-gray-900">{user?.name}</p>
                <p className="text-xs leading-tight text-gray-500">{user?.email}</p>
              </div>
              <img
                src={user?.avatarUrl ?? undefined}
                alt={user?.name ?? ""}
                className="h-9 w-9 rounded-full bg-brand-100 ring-2 ring-brand-200"
                onError={(e) => {
                  const el = e.target as HTMLImageElement;
                  el.src = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 36 36'><rect width='36' height='36' fill='%23dbe6fe'/><text x='18' y='23' text-anchor='middle' font-size='16' fill='%232553eb'>%40</text></svg>";
                }}
              />
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await logout();
                navigate("/");
              }}
            >
              Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label="Scheduled" value={stats.data?.emails.scheduled ?? (stats.loading ? "…" : 0)} accent="text-amber-600" />
          <StatCard label="Sent" value={stats.data?.emails.sent ?? (stats.loading ? "…" : 0)} accent="text-emerald-600" />
          <StatCard label="Failed" value={stats.data?.emails.failed ?? (stats.loading ? "…" : 0)} accent="text-red-600" />
          <StatCard
            label="In queue"
            value={
              stats.data ? stats.data.queue.waiting + stats.data.queue.delayed + stats.data.queue.active : stats.loading ? "…" : 0
            }
            accent="text-brand-600"
          />
          <StatCard
            label="Sends this hour"
            value={stats.data ? `${stats.data.rate.globalCountThisHour}${stats.data.rate.maxEmailsPerHour ? ` / ${stats.data.rate.maxEmailsPerHour}` : ""}` : "…"}
          />
        </div>

        {/* Tabs + compose */}
        <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Tabs
            items={[
              { key: "scheduled", label: "Scheduled Emails", count: scheduled.data?.total ?? undefined },
              { key: "sent", label: "Sent Emails", count: (sent.data?.total ?? 0) + failedCount },
              { key: "search", label: "Search" },
            ]}
            active={tab}
            onChange={(k) => setTab(k as TabKey)}
          />
          <Button onClick={() => setComposeOpen(true)}>
            <span className="text-base leading-none">＋</span> Compose New Email
          </Button>
        </div>

        <div className="mt-4">
          {tab === "scheduled" && (
            <>
              {scheduled.error ? (
                <ErrorState message={scheduled.error} onRetry={scheduled.refresh} />
              ) : scheduled.loading ? (
                <TableSkeleton cols={4} />
              ) : scheduledRows.length === 0 ? (
                <EmptyState
                  title="No scheduled emails"
                  message="Compose a new email campaign to see scheduled emails here."
                  action={<Button onClick={() => setComposeOpen(true)}>Compose New Email</Button>}
                />
              ) : (
                <Table columns={scheduledColumns} rows={scheduledRows} />
              )}
            </>
          )}

          {tab === "sent" && (
            <>
              {sent.error ? (
                <ErrorState message={sent.error} onRetry={sent.refresh} />
              ) : sent.loading && failed.loading ? (
                <TableSkeleton cols={5} />
              ) : (sent.data?.emails ?? []).length + (failed.data?.emails ?? []).length === 0 ? (
                <EmptyState
                  title="No sent emails yet"
                  message="Once your scheduled emails fire, they'll appear here with their status."
                />
              ) : (
                <Table
                  columns={sentColumns}
                  rows={[...(failed.data?.emails ?? []), ...(sent.data?.emails ?? [])].sort(
                    (a, b) => new Date(b.sentAt ?? b.scheduledAt).getTime() - new Date(a.sentAt ?? a.scheduledAt).getTime()
                  )}
                />
              )}
            </>
          )}

          {tab === "search" && (
            <div>
              <form onSubmit={runSearch} className="flex gap-2">
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by recipient, subject, or body… (Elasticsearch)"
                  className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
                <Button type="submit" loading={searching}>
                  Search
                </Button>
              </form>

              {searchError && (
                <div className="mt-4">
                  <ErrorState message={searchError} />
                </div>
              )}

              {searchResults && !searchError && (
                <div className="mt-4">
                  {searchResults.length === 0 ? (
                    <EmptyState title="No results" message={`Nothing matched "${searchQuery}".`} />
                  ) : (
                    <Table
                      columns={
                        [
                          {
                            key: "recipient",
                            header: "Email",
                            render: (r: (typeof searchResults)[number]) => (
                              <span className="font-medium text-gray-900">{r.recipient}</span>
                            ),
                          },
                          {
                            key: "subject",
                            header: "Subject",
                            render: (r: (typeof searchResults)[number]) => <span className="text-gray-600">{r.subject}</span>,
                          },
                          {
                            key: "status",
                            header: "Status",
                            render: (r: (typeof searchResults)[number]) => <StatusBadge status={r.status} />,
                          },
                          {
                            key: "sentAt",
                            header: "Sent Time",
                            render: (r: (typeof searchResults)[number]) => formatDateTime(r.sentAt ?? r.scheduledAt),
                          },
                        ] as Column<(typeof searchResults)[number]>[]
                      }
                      rows={searchResults.map((r: NonNullable<typeof searchResults>[number]) => ({ ...r, id: r.id }))}
                    />
                  )}
                </div>
              )}

              {!searchResults && !searchError && (
                <p className="mt-6 text-center text-sm text-gray-400">
                  {stats.data && !stats.data.elasticsearchAvailable
                    ? "Elasticsearch is offline — run `docker compose up -d` to enable search."
                    : "Type a query to search across all your emails."}
                </p>
              )}
            </div>
          )}
        </div>
      </main>

      <ComposeModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        onScheduled={() => {
          scheduled.refresh();
          sent.refresh();
          stats.refresh();
        }}
      />
    </div>
  );
}
