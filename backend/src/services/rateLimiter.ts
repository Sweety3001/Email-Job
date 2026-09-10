import { env } from "../config/env";

/**
 * Hourly rate limiting backed by Redis atomic counters.
 *
 * Counters are keyed by `rate:{scope}:{yyyyMMddHH}` where scope is either
 * `global` or `sender:{senderId}`. INCR + EXPIRE are executed as a single
 * Lua script so the check-and-increment is atomic — safe across multiple
 * workers / processes / instances (no in-memory state anywhere).
 */

const INCR_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return count
`;

export interface RateDecision {
  allowed: boolean;
  /** When the next hour window starts (ms epoch), if not allowed. */
  nextWindowStart: number;
  scope: string;
  limit: number;
  currentCount: number;
}

function hourKey(prefix: string, d = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  return `rate:${prefix}:${y}${m}${day}${h}`;
}

/** Start of the next UTC hour, in ms epoch. */
export function nextHourStart(now = new Date()): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours() + 1);
}

async function checkAndIncr(key: string, limit: number, now: Date): Promise<RateDecision | null> {
  if (limit <= 0) return null; // 0 = unlimited
  const count = (await evalIncr(key, 2 * 60 * 60 * 1000)) as number;
  if (count > limit) {
    return {
      allowed: false,
      nextWindowStart: nextHourStart(now),
      scope: key,
      limit,
      currentCount: count,
    };
  }
  return null;
}

async function evalIncr(key: string, ttlMs: number): Promise<number> {
  const { redis } = await import("../lib/redis");
  const result = await redis.eval(INCR_SCRIPT, 1, key, ttlMs);
  return Number(result);
}

/**
 * Try to consume one send slot for this sender, enforcing the configured
 * rate limit mode. Returns null if allowed (counter already incremented),
 * or a RateDecision describing which limit was hit.
 *
 * IMPORTANT: this increments counters even when the caller ultimately
 * does not send (e.g. a duplicate job). That is a deliberate trade-off —
 * counters stay conservative; see README "Trade-offs".
 */
export async function tryConsumeSendSlot(senderId: string, now = new Date()): Promise<RateDecision | null> {
  const mode = env.rateLimitMode;

  if (mode === "global" || mode === "both") {
    const hit = await checkAndIncr(hourKey("global", now), env.maxEmailsPerHour, now);
    if (hit) return hit;
  }
  if (mode === "sender" || mode === "both") {
    const hit = await checkAndIncr(hourKey(`sender:${senderId}`, now), env.maxEmailsPerHourPerSender, now);
    if (hit) return hit;
  }
  return null;
}

/** Current count for a scope, without incrementing (for the stats API). */
export async function currentCount(scope: "global" | string /* senderId */, now = new Date()): Promise<number> {
  const { redis } = await import("../lib/redis");
  const key = scope === "global" ? hourKey("global", now) : hourKey(`sender:${scope}`, now);
  const v = await redis.get(key);
  return v ? Number(v) : 0;
}

/** Peek-only check (no increment) — used by the worker to avoid burning attempts. */
export async function wouldExceedLimit(senderId: string, now = new Date()): Promise<RateDecision | null> {
  const { redis } = await import("../lib/redis");
  const mode = env.rateLimitMode;

  if (mode === "global" || mode === "both") {
    if (env.maxEmailsPerHour > 0) {
      const v = await redis.get(hourKey("global", now));
      if (v && Number(v) >= env.maxEmailsPerHour) {
        return { allowed: false, nextWindowStart: nextHourStart(now), scope: "global", limit: env.maxEmailsPerHour, currentCount: Number(v) };
      }
    }
  }
  if (mode === "sender" || mode === "both") {
    if (env.maxEmailsPerHourPerSender > 0) {
      const v = await redis.get(hourKey(`sender:${senderId}`, now));
      if (v && Number(v) >= env.maxEmailsPerHourPerSender) {
        return { allowed: false, nextWindowStart: nextHourStart(now), scope: `sender:${senderId}`, limit: env.maxEmailsPerHourPerSender, currentCount: Number(v) };
      }
    }
  }
  return null;
}

/**
 * Per-campaign hourly limit (optional, set per campaign from the compose
 * form). Same atomic-counter mechanism, keyed by campaign id.
 */
export async function tryConsumeCampaignSlot(
  campaignId: string,
  limit: number,
  now = new Date()
): Promise<RateDecision | null> {
  if (!limit || limit <= 0) return null;
  const key = hourKey(`campaign:${campaignId}`, now);
  const count = await evalIncr(key, 2 * 60 * 60 * 1000);
  if (count > limit) {
    return {
      allowed: false,
      nextWindowStart: nextHourStart(now),
      scope: `campaign:${campaignId}`,
      limit,
      currentCount: count,
    };
  }
  return null;
}

export async function campaignWouldExceed(
  campaignId: string,
  limit: number,
  now = new Date()
): Promise<RateDecision | null> {
  if (!limit || limit <= 0) return null;
  const { redis } = await import("../lib/redis");
  const v = await redis.get(hourKey(`campaign:${campaignId}`, now));
  if (v && Number(v) >= limit) {
    return {
      allowed: false,
      nextWindowStart: nextHourStart(now),
      scope: `campaign:${campaignId}`,
      limit,
      currentCount: Number(v),
    };
  }
  return null;
}

/**
 * Minimum delay between individual sends (provider throttling mimic).
 * Uses a Redis lock `throttle:{key}` with SET NX PX — atomic across
 * workers. Returns 0 if the send may proceed, or the number of ms to
 * wait before this send's turn.
 */
export async function acquireThrottle(key: string): Promise<number> {
  if (env.minDelayMs <= 0) return 0;
  const { redis } = await import("../lib/redis");
  const lockKey = `throttle:${key}`;
  const ok = await redis.set(lockKey, "1", "PX", env.minDelayMs, "NX");
  if (ok === "OK") return 0;
  // Lock held — wait until it expires.
  const ttl = await redis.pttl(lockKey);
  return ttl > 0 ? ttl : 0;
}

/** Key used for throttling given the rate limit mode. */
export function throttleKey(senderId: string): string {
  // Global pacing when limits are global; per-sender pacing otherwise.
  return env.rateLimitMode === "global" ? "global" : senderId;
}
