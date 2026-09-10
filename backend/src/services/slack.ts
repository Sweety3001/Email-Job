import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import { redis } from "../lib/redis";
import type { RateDecision } from "./rateLimiter";

/**
 * Slack integration (real OAuth v2 + chat.postMessage).
 *
 * - "Connect Slack" on the dashboard redirects to /api/slack/authorize →
 *   Slack consent screen (scope: chat:write) → /api/slack/callback →
 *   token exchange → stored per-user in Postgres.
 * - On a rate-limit hit, the worker calls notifyRateLimitHit which reads
 *   the integration FRESH from the DB on every call — so connecting
 *   Slack later starts notifications with no redeploy, and disconnecting
 *   stops them immediately.
 * - Not connected → silent no-op (never crashes the send path).
 * - One notification per (scope, hour window), guarded by a Redis NX flag.
 */

export function slackAuthorizeUrlFor(origin: string, state: string): string {
  const params = new URLSearchParams({
    client_id: env.slackClientId,
    scope: "chat:write,channels:read",
    redirect_uri: `${origin}/api/slack/callback`,
    state,
  });
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

export interface SlackTokenResponse {
  ok: boolean;
  error?: string;
  access_token?: string;
  token_type?: string;
  scope?: string;
  bot_user_id?: string;
  team?: { id: string; name: string };
  // When the app is installed to a workspace, incoming_webhook may be absent;
  // we use chat.postMessage with the bot token instead.
  incoming_webhook?: { url: string; channel: string; channel_id: string };
  authed_user?: { id: string };
}

export async function exchangeSlackCode(code: string, origin: string): Promise<SlackTokenResponse> {
  const res = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.slackClientId,
      client_secret: env.slackClientSecret,
      code,
      redirect_uri: `${origin}/api/slack/callback`,
    }),
  });
  return (await res.json()) as SlackTokenResponse;
}

/** Where the bot should post. Uses the channel the app was installed into. */
export async function findBotChannel(botToken: string): Promise<{ channelId: string; name: string } | null> {
  const res = await fetch("https://slack.com/api/conversations.list?types=public_channel&limit=200", {
    headers: { Authorization: `Bearer ${botToken}` },
  });
  const data = (await res.json()) as {
    ok: boolean;
    error?: string;
    channels?: { id: string; name: string; is_general?: boolean }[];
  };
  if (!data.ok) {
    console.error("[slack] conversations.list failed:", data.error);
    return null;
  }
  if (!data.channels || data.channels.length === 0) {
    console.error("[slack] conversations.list returned empty channels array");
    return null;
  }
  // Prefer #general, else the first channel.
  const general = data.channels.find((c) => c.is_general) ?? data.channels[0];
  return { channelId: general.id, name: general.name };
}

export async function saveSlackIntegration(
  userId: string,
  botToken: string,
  channelId: string,
  teamName: string | null,
  scopes: string | null
): Promise<void> {
  await prisma.slackIntegration.upsert({
    where: { userId },
    create: { userId, botToken, channelId, teamName, scopes },
    update: { botToken, channelId, teamName, scopes },
  });
}

export async function getSlackIntegration(userId: string) {
  return prisma.slackIntegration.findUnique({ where: { userId } });
}

export async function deleteSlackIntegration(userId: string): Promise<void> {
  await prisma.slackIntegration.deleteMany({ where: { userId } });
}

export async function postSlackMessage(
  botToken: string,
  channelId: string,
  text: string
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ channel: channelId, text }),
  });
  return (await res.json()) as { ok: boolean; error?: string };
}

/**
 * Called by the worker the moment an hourly limit is reached.
 * - Once per (scope, window) via a Redis NX flag.
 * - Reads the integration fresh from the DB each time.
 * - No integration → silent return.
 */
export async function notifyRateLimitHit(decision: RateDecision): Promise<void> {
  // Which users to notify? For this single-tenant-per-user demo we notify
  // every connected user (each has their own Slack workspace). In a real
  // multi-tenant system this would be keyed by the email's tenant.
  const integrations = await prisma.slackIntegration.findMany();
  if (integrations.length === 0) return;

  // Once-per-window guard (Redis NX, TTL 1h).
  const windowKey = `slack:notified:${decision.scope}:${decision.currentCount}`;
  const alreadyNotified = await redis.set(windowKey, "1", "EX", 3600, "NX");
  if (alreadyNotified !== "OK") return;

  const friendlyScope = decision.scope.includes("sender") ? "a sender" : "the global";
  const message =
    `:rotating_light: *ReachInbox rate limit reached*\n` +
    `${friendlyScope} hourly send limit has been hit (${decision.limit} emails/hour).\n` +
    `Pending emails have been rescheduled into the next hour window — nothing was dropped.\n` +
    `_Scope: ${decision.scope} · Count: ${decision.currentCount}_`;

  for (const integration of integrations) {
    try {
      const result = await postSlackMessage(integration.botToken, integration.channelId, message);
      if (!result.ok) {
        console.warn(`[slack] chat.postMessage failed for user ${integration.userId}: ${result.error}`);
      } else {
        console.log(`[slack] rate-limit notification sent to user ${integration.userId}`);
      }
    } catch (err) {
      console.warn(`[slack] notification error for user ${integration.userId}:`, (err as Error).message);
    }
  }
}
