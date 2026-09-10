import { Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { Button } from "../components/Button";

const features = [
  {
    icon: "⏰",
    title: "Precise Scheduling",
    text: "Emails go out exactly when you want — BullMQ delayed jobs backed by persistent Redis.",
  },
  {
    icon: "🛡️",
    title: "Rate Limiting",
    text: "Configurable hourly caps per sender and globally. Overflow is rescheduled, never dropped.",
  },
  {
    icon: "🔁",
    title: "Restart-Safe",
    text: "Postgres + Redis reconciliation means a crashed server never loses or duplicates a send.",
  },
  {
    icon: "🔎",
    title: "Full-Text Search",
    text: "Every email indexed into Elasticsearch — search recipients, subjects, and bodies instantly.",
  },
  {
    icon: "🤖",
    title: "Slack Alerts",
    text: "Real Slack OAuth — get pinged in your workspace the moment a sender hits its hourly limit.",
  },
  {
    icon: "📊",
    title: "Live Queue Board",
    text: "A BullMQ dashboard shows waiting, delayed, active and completed jobs in real time.",
  },
];

export default function Home() {
  const { user, loading } = useAuth();

  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-50 via-white to-white">
      {/* Nav */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2">
          <span className="text-xl">📬</span>
          <span className="text-lg font-bold tracking-tight text-gray-900">ReachInbox</span>
          <span className="rounded-md bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-700">Scheduler</span>
        </div>
        <nav className="flex items-center gap-3">
          {!loading && user ? (
            <>
              <Link to="/dashboard">
                <Button variant="primary" size="sm">
                  Go to dashboard
                </Button>
              </Link>
              <img
                src={user.avatarUrl ?? undefined}
                alt=""
                className="h-8 w-8 rounded-full ring-2 ring-brand-200 object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            </>
          ) : (
            <Link to="/login">
              <Button variant="secondary" size="sm">
                Sign in with Google
              </Button>
            </Link>
          )}
        </nav>
      </header>

      {/* Hero */}
      <main className="mx-auto max-w-6xl px-6 pb-24 pt-16">
        <div className="flex flex-col items-center text-center">
          <h1 className="max-w-3xl text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl">
            Schedule and send cold email at scale —{" "}
            <span className="bg-gradient-to-r from-brand-600 to-brand-400 bg-clip-text text-transparent">
              reliably.
            </span>
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-gray-600">
            A production-grade email scheduler: delayed BullMQ jobs, per-sender rate limits, restart-safe persistence,
            Elasticsearch search and live Slack alerts — all in one dashboard.
          </p>
          <div className="mt-8 flex gap-3">
            <Link to={user ? "/dashboard" : "/login"}>
              <Button size="lg" variant="primary">
                {user ? "Open dashboard" : "Sign in with Google"} →
              </Button>
            </Link>
            <a href="http://localhost:4000/admin/queues" target="_blank" rel="noreferrer">
              <Button size="lg" variant="secondary">
                Live queue board
              </Button>
            </a>
          </div>
        </div>

        {/* Feature grid */}
        <div className="mt-20 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
              <div className="text-2xl">{f.icon}</div>
              <h3 className="mt-3 text-base font-semibold text-gray-900">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-gray-600">{f.text}</p>
            </div>
          ))}
        </div>

        {/* Architecture strip */}
        <div className="mt-20 rounded-2xl border border-gray-200 bg-gray-50 p-8">
          <h2 className="text-center text-sm font-semibold uppercase tracking-widest text-gray-500">Under the hood</h2>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3 text-sm font-medium text-gray-700">
            {["React + Vite", "Express + TypeScript", "BullMQ", "Redis (AOF)", "PostgreSQL", "Ethereal SMTP", "Elasticsearch", "Slack API"].map(
              (tech, i) => (
                <span key={tech} className="flex items-center gap-3">
                  <span className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 shadow-sm">{tech}</span>
                  {i < 7 && <span className="text-gray-300">→</span>}
                </span>
              )
            )}
          </div>
        </div>
      </main>

      <footer className="border-t border-gray-200 bg-white py-6 text-center text-sm text-gray-400">
        Built for the ReachInbox hiring assignment · Express · BullMQ · Redis · PostgreSQL · Elasticsearch
      </footer>
    </div>
  );
}
