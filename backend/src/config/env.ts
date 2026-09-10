import dotenv from "dotenv";
dotenv.config();

function int(v: string | undefined, fallback: number): number {
  const n = parseInt(v ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
}

function optInt(v: string | undefined): number | undefined {
  if (v === undefined || v === "") return undefined;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}

export interface SenderConfig {
  name: string;
  email: string;
  smtpUser: string;
  smtpPass: string;
}

function parseSenders(raw: string | undefined): SenderConfig[] {
  if (!raw || raw.trim() === "") return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s) => s && typeof s.smtpUser === "string" && typeof s.smtpPass === "string")
      .map((s) => ({
        name: String(s.name ?? s.email ?? s.smtpUser),
        email: String(s.email ?? s.smtpUser),
        smtpUser: String(s.smtpUser),
        smtpPass: String(s.smtpPass),
      }));
  } catch {
    console.error("[env] SENDERS is set but not valid JSON — ignoring it");
    return [];
  }
}

export const env = {
  port: int(process.env.PORT, 4000),
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:5173",

  databaseUrl: process.env.DATABASE_URL ?? "",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  elasticsearchUrl: process.env.ELASTICSEARCH_URL ?? "http://localhost:9200",

  jwtSecret: process.env.JWT_SECRET ?? "",
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",

  slackClientId: process.env.SLACK_CLIENT_ID ?? "",
  slackClientSecret: process.env.SLACK_CLIENT_SECRET ?? "",

  senders: parseSenders(process.env.SENDERS),

  emailWorkerConcurrency: int(process.env.EMAIL_WORKER_CONCURRENCY, 5),
  minDelayMs: int(process.env.MIN_DELAY_MS, 2000),
  maxEmailsPerHour: int(process.env.MAX_EMAILS_PER_HOUR, 200),
  maxEmailsPerHourPerSender: int(process.env.MAX_EMAILS_PER_HOUR_PER_SENDER, 100),
  rateLimitMode: (["global", "sender", "both"].includes(String(process.env.RATE_LIMIT_MODE))
    ? String(process.env.RATE_LIMIT_MODE)
    : "both") as "global" | "sender" | "both",

  emailQueueName: process.env.EMAIL_QUEUE_NAME ?? "email-dispatch",
};

export function warnMissingConfig(): void {
  const missing: string[] = [];
  if (!env.jwtSecret) missing.push("JWT_SECRET");
  if (!env.googleClientId) missing.push("GOOGLE_CLIENT_ID");
  if (!env.googleClientSecret) missing.push("GOOGLE_CLIENT_SECRET");
  if (!env.slackClientId) missing.push("SLACK_CLIENT_ID");
  if (!env.slackClientSecret) missing.push("SLACK_CLIENT_SECRET");
  if (!env.databaseUrl) missing.push("DATABASE_URL");
  if (missing.length > 0) {
    console.warn(`[env] Missing/empty: ${missing.join(", ")}`);
    if (missing.includes("GOOGLE_CLIENT_ID") || missing.includes("GOOGLE_CLIENT_SECRET")) {
      console.warn("[env] Google login will not work until GOOGLE_CLIENT_ID/SECRET are set.");
    }
    if (missing.includes("SLACK_CLIENT_ID") || missing.includes("SLACK_CLIENT_SECRET")) {
      console.warn("[env] Slack connect will not work until SLACK_CLIENT_ID/SECRET are set.");
    }
  }
}
