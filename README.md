# 📬 ReachInbox — Full-stack Email Job Scheduler

A production-grade email scheduling service + dashboard built for the ReachInbox hiring assignment.

Accepts email send requests via API → stores them in PostgreSQL → schedules them with **BullMQ delayed jobs (Redis)** (no cron anywhere) → sends via **Ethereal fake SMTP** from multiple senders → indexes everything into **Elasticsearch** for search → notifies **Slack** when an hourly rate limit is hit → survives restarts without losing or duplicating a single email.

---

## 🧱 Stack

| Layer | Tech |
|---|---|
| Backend | Express.js + TypeScript |
| Queue / Scheduler | BullMQ + Redis (AOF persistence) — **no cron, no node-cron, no agenda** |
| Database | PostgreSQL + Prisma ORM |
| SMTP | Ethereal Email (fake SMTP, real protocol, preview URLs) |
| Search | Elasticsearch 8 |
| Auth | Google OAuth 2.0 (real) + JWT httpOnly cookie |
| Notifications | Slack OAuth v2 + `chat.postMessage` (real) |
| Queue visibility | @bull-board at `/admin/queues` |
| Frontend | React 18 + Vite + TypeScript + Tailwind CSS (light theme) |

---

## 🚀 Running the App

### Prerequisites

- Node.js 18+
- Docker (for Redis, PostgreSQL, Elasticsearch)

### 1. Start the infrastructure

```bash
docker compose up -d          # postgres :5432, redis :6379 (AOF on), elasticsearch :9200
```

### 2. Backend

```bash
cd backend
cp .env.example .env          # fill in the OAuth credentials (see below)
npm install
npx prisma migrate dev        # creates the schema
npm run dev                   # API server on http://localhost:4000
```

In a **second terminal** (jobs are processed by a separate worker process):

```bash
cd backend
npm run dev:worker            # BullMQ worker
```

- API: http://localhost:4000
- Live BullMQ dashboard: http://localhost:4000/admin/queues
- Health: http://localhost:4000/api/health

### 3. Frontend

```bash
cd frontend
npm install
npm run dev                   # http://localhost:5173
```

### 4. Environment setup (backend/.env)

Everything is configurable — no hardcoded limits.

```env
PORT=4000
FRONTEND_URL=http://localhost:5173
DATABASE_URL=postgresql://reachinbox:reachinbox@localhost:5432/reachinbox?schema=public
REDIS_URL=redis://localhost:6379
ELASTICSEARCH_URL=http://localhost:9200
JWT_SECRET=<long random string>

GOOGLE_CLIENT_ID=...        # Google Cloud Console (see below)
GOOGLE_CLIENT_SECRET=...

SLACK_CLIENT_ID=...         # api.slack.com/apps (see below)
SLACK_CLIENT_SECRET=...

# Throughput / rate limiting
EMAIL_WORKER_CONCURRENCY=5  # parallel jobs per worker
MIN_DELAY_MS=2000           # min 2 seconds between individual sends
MAX_EMAILS_PER_HOUR=200     # global hourly cap (0 = unlimited)
MAX_EMAILS_PER_HOUR_PER_SENDER=100
RATE_LIMIT_MODE=both        # global | sender | both
```

#### Google OAuth setup

1. https://console.cloud.google.com → create project → **APIs & Services → Credentials → Create OAuth client ID → Web application**.
2. Authorized redirect URI: `http://localhost:4000/api/auth/google/callback`
3. (Configure the OAuth consent screen with your Google account as a test user.)
4. Copy client id/secret into `.env`.

#### Slack OAuth setup

1. https://api.slack.com/apps → **Create New App → From scratch**.
2. **OAuth & Permissions → Scopes** (Bot Token Scopes): `chat:write`, `channels:read`.
3. **OAuth & Permissions → Redirect URLs**: `http://localhost:4000/api/slack/callback`
4. Install to workspace, copy client id/secret into `.env`.
5. In the app: click **Connect Slack** on the dashboard → authorize → done.

#### Ethereal Email

No account needed: if `SENDERS` is empty, the backend **auto-creates 2 Ethereal test accounts** on first boot and logs their credentials. Every sent email stores its **preview URL** (visible in the Sent Emails table — "View in Ethereal ↗"). You can also paste your own Ethereal accounts into `SENDERS` as JSON.

---

## 🏗 Architecture

```
                       ┌────────────────────────────────────────────┐
 Browser ──Google────▶ │  Express API (:4000)                       │
            OAuth JWT  │  /api/campaigns  /api/emails  /api/stats   │
                       │  /api/auth/*     /api/slack/*  /admin/queues│
                       └───────┬───────────────────────┬────────────┘
                               │ write rows            │ add delayed jobs
                               ▼                       ▼
                       ┌──────────────┐        ┌───────────────────┐
                       │  PostgreSQL  │        │  Redis (AOF)      │
                       │  campaigns   │◀──────▶│  BullMQ queue     │
                       │  emails      │ recon- │  rate counters    │
                       │  senders     │  cile  │  throttle locks   │
                       │  users,slack │        │  notify flags     │
                       └──────▲───────┘        └───────┬───────────┘
                              │ status flips           │ delayed jobs mature
                              │                        ▼
                              │                ┌───────────────────┐
                              │                │  Worker process    │
                              │                │  concurrency=5     │
                              │                │  throttle + rate   │
                              │                │  limit checks      │
                              │                └───┬────────┬──────┘
                              │      sent/failed    │        │ rate-limit hit
                              └─────────────────────┘        ▼
                                                    ┌────────────────┐
                     Elasticsearch ◀── index on send │ Ethereal SMTP  │
                     (emails index, search API)     │ (2 senders)    │
                                                    └────────────────┘
                                                            │ limit hit
                                                            ▼
                                                    Slack chat.postMessage
```

### How scheduling works (no cron)

1. `POST /api/campaigns` creates the **Campaign + one Email row per recipient in a single transaction**, with `scheduledAt = startTime + i × delaySeconds`.
2. For each email, a **BullMQ delayed job** is added with **`jobId = email:{rowId}`** and `delay = scheduledAt − now`. BullMQ keeps delayed jobs in a Redis sorted set and moves them to "waiting" exactly at their timestamp — this *is* the scheduler.
3. The **worker process** (separate from the API) picks up matured jobs, re-reads the email row from Postgres, and sends.

### Persistence on restart

- **Redis runs with AOF** (`--appendonly yes`), so the queue (incl. delayed jobs) survives Redis restarts.
- On worker boot, a **reconciliation pass** re-enqueues every email row still `scheduled`/`sending` that has no live job — safe even if Redis was flushed, because BullMQ **rejects duplicate jobIds** (idempotent re-add).
- If the server dies between job pickup and send, the row stays `sending`; the job re-runs after restart and the atomic status flip (`updateMany WHERE status='scheduled'`) guarantees the send happens exactly once.
- **No email is ever re-sent from day 1** — `sent` rows are skipped on sight.

### Idempotency (no duplicate sends)

Three independent layers:
1. **DB**: unique `(campaignId, recipient)` — same recipient can't be queued twice in a campaign.
2. **Queue**: custom `jobId = email:{id}` — BullMQ rejects duplicate adds.
3. **Worker**: atomic `updateMany WHERE status='scheduled'` flip to `sending` — concurrent workers/instances can't double-send; already-`sent` rows short-circuit.

### Rate limiting & concurrency

- **Concurrency**: `EMAIL_WORKER_CONCURRENCY` (default 5) — configurable parallel job processing per worker.
- **Min delay between sends**: `MIN_DELAY_MS` (default 2000ms = "min 2 seconds between sends"). Implemented as a Redis lock `SET NX PX` per throttle key — atomic across all workers/instances.
- **Hourly limits**: `MAX_EMAILS_PER_HOUR` (global) and/or `MAX_EMAILS_PER_HOUR_PER_SENDER`, selected by `RATE_LIMIT_MODE`. Enforced with **Redis atomic counters** (`INCR` + `PEXPIRE` via Lua, keyed by `rate:{scope}:{yyyymmddhh}`) — safe across multiple workers/instances, no in-memory state.
- **When a limit is hit**: jobs are **never dropped or failed** — `job.moveToDelayed(nextHourStart + stagger)` reschedules them into the next window, order roughly preserved by a stable per-email stagger. A Slack notification fires (once per scope+window).
- **Under load (1000+ emails at once)**: jobs simply pile into BullMQ's delayed set; the hourly limiter paces them into successive windows (e.g. 200/hour → 1000 emails complete over ~5 hours). Nothing is lost and no thundering herd hits SMTP.

### Slack notifications

Real OAuth v2 flow: **Connect Slack** in the dashboard → authorize in your workspace → backend stores the bot token per user. On a rate-limit hit, the worker reads the integration **fresh from the DB** (so connecting later works with no redeploy; disconnecting stops notifications instantly) and calls `chat.postMessage`. No integration connected → silent no-op, never a crash.

### Elasticsearch

Every email is indexed on create + on status change (`emails` index, custom `email_analyzer` for recipient search). `GET /api/emails/search?q=` does a filtered multi-match (recipient/subject/body) + wildcard. Indexing is fire-and-forget: if ES is down, everything else keeps working and search returns a clear 503.

---

## ✅ Features ↔ Requirements

### Backend

| Requirement | Where |
|---|---|
| Schedule emails at a specific time | `POST /api/campaigns` → BullMQ delayed jobs |
| No cron jobs | Scheduling is 100% BullMQ delayed jobs in Redis |
| Relational DB storage | PostgreSQL + Prisma (`campaigns`, `emails`, `senders`, `users`, `slack_integrations`) |
| BullMQ + Redis persistent scheduler | `lib/queues.ts`, AOF-enabled Redis |
| Fake SMTP via Ethereal | `services/senders.ts` (auto-creates 2 accounts; preview URLs stored) |
| Multiple senders | Sender pool, round-robin assignment per campaign |
| Elasticsearch indexing + search | `services/search.ts`, `GET /api/emails/search` |
| Live BullMQ dashboard | `@bull-board` at `/admin/queues` |
| Survives server restarts | AOF Redis + boot reconciliation + jobId dedupe (see above) |
| No duplicate sends | 3-layer idempotency (DB unique, jobId, atomic status flip) |
| Configurable worker concurrency | `EMAIL_WORKER_CONCURRENCY` |
| Min delay between sends | `MIN_DELAY_MS` (Redis NX lock) |
| Configurable hourly rate limits | `MAX_EMAILS_PER_HOUR`, `MAX_EMAILS_PER_HOUR_PER_SENDER`, `RATE_LIMIT_MODE` |
| Redis-backed counters (multi-instance safe) | Lua `INCR`+`PEXPIRE` in `services/rateLimiter.ts` |
| Limit hit → reschedule, never drop | `job.moveToDelayed(nextWindowStart + stagger)` |
| Slack notification on limit hit | Real `chat.postMessage`, token read fresh from DB |
| 1000+ emails behavior | Delayed-set backpressure + hourly pacing (documented above) |

### Frontend

| Requirement | Where |
|---|---|
| Real Google OAuth login | `/login` → backend OAuth → JWT cookie → dashboard |
| Header with name, email, avatar, logout | Dashboard header |
| Landing/home page | `/` hero + features |
| Scheduled Emails tab | Table: email, subject, scheduled time, status + loading/empty states |
| Sent Emails tab | Table: email, subject, sent time, sent/failed + preview links + loading/empty states |
| Compose New Email | Modal: subject, body, CSV upload w/ "N emails detected", start time, delay, hourly limit |
| Elasticsearch search tab | Search box + results table |
| Slack Connect/Disconnect chip | Dashboard header, real OAuth redirect |
| Reusable components | `Button`, `Input`/`Textarea`, `Modal`, `Table`/`TableSkeleton`/`EmptyState`/`ErrorState`, `StatusBadge`, `Tabs`, `Toast` |
| TypeScript everywhere | Full types for all API responses/requests (`src/types`) |
| Live updates | 5s polling of emails + stats |
| Loading / empty / error states | All tables and stats |

---

## 🎬 Demo script (for the ≤5-minute video)

1. **Setup** (30s): `docker compose up -d`, backend + worker + frontend running.
2. **Login** (30s): Google sign-in → dashboard shows name/email/avatar in header.
3. **Compose** (60s): Compose New Email → upload `leads.csv` → "N email addresses detected" → start time = now + 1 min, delay 10s, schedule.
4. **Scheduled → Sent** (60s): Watch the Scheduled table, then emails flip to Sent with Ethereal preview links. Open one preview URL.
5. **Queue board** (20s): Show `/admin/queues` with delayed/waiting/completed counts.
6. **Restart test** (60s): Schedule a 10-email campaign with 20s delays. Mid-campaign, Ctrl+C both backend and worker (optionally `docker compose restart redis`). Start them again → remaining emails still send at the right time, no duplicates.
7. **Rate limit + Slack** (60s): Set `MAX_EMAILS_PER_HOUR_PER_SENDER=3` (and small `MIN_DELAY_MS`), connect Slack, schedule 10 emails → after 3 sends, jobs visibly move to the next hour window, Slack message arrives.

---

## ⚖️ Assumptions & trade-offs

- **Counters increment before the send completes** — if a send fails after consuming a slot, that slot is "wasted". Keeps the limiter simple and conservative (never exceeds the cap); a token-bucket refund would be the next step.
- **Per-user vs global rate scope**: hourly limits are enforced per sender / globally (as the spec allows). Slack notifications go to all connected users in this single-tenant demo; in multi-tenant production they'd be routed by the email's tenant.
- **Slack notify-once guard** is keyed per scope+window via Redis NX — a second window hit notifies again, but a re-delayed job in the same window doesn't spam.
- **Ethereal is slow and rate-limit-happy itself** — that's fine, it's fake SMTP for testing; failures are retried with exponential backoff (5 attempts) before being marked `failed`.
- **CSV parsing happens client-side** (and the backend re-validates) — keeps the payload small and gives instant "N detected" feedback.
- **JWT in an httpOnly cookie** (not localStorage) with `sameSite: lax` — fine for the localhost demo; `secure: true` would be set behind HTTPS.
- **Search degrades gracefully**: if Elasticsearch is down, the app works fully minus search (503 with a helpful message).
- **`sending` rows with no worker heartbeat**: a crashed mid-send row older than 60s is retried on the next job attempt — the atomic flip is retried, not the send itself, preserving exactly-once delivery.

## 📁 Repository structure

```
backend/
  prisma/schema.prisma        # Postgres schema
  src/
    server.ts                 # Express API + bull-board
    worker.ts                 # BullMQ worker entrypoint
    config/env.ts             # all configuration (validated)
    lib/                      # prisma, redis, queue factory
    routes/                   # auth, campaigns, emails, senders, slack, stats
    services/                 # scheduler, emailWorker, rateLimiter, senders, slack, search
frontend/
  src/
    api/client.ts             # typed API client
    components/               # Button, Input, Modal, Table, Tabs, Toast, ComposeModal...
    pages/                    # Home, Login, Dashboard
    hooks/                    # useAuth, usePolling
    lib/                      # csv parsing, formatting
docker-compose.yml            # postgres + redis(AOF) + elasticsearch
```
