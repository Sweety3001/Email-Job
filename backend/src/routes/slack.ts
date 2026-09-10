import { Router, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { requireAuth } from "../middleware/auth";
import { env } from "../config/env";
import {
  slackAuthorizeUrlFor,
  exchangeSlackCode,
  findBotChannel,
  saveSlackIntegration,
  getSlackIntegration,
  deleteSlackIntegration,
} from "../services/slack";

const router = Router();

// CSRF state store (in-memory is fine for this short-lived OAuth dance).
const pendingStates = new Map<string, { userId: string; expiresAt: number }>();
const STATE_TTL = 10 * 60 * 1000;

function cleanupStates(): void {
  const now = Date.now();
  for (const [k, v] of pendingStates) if (v.expiresAt < now) pendingStates.delete(k);
}

// GET /api/slack/authorize → redirect to Slack consent (real OAuth)
router.get("/authorize", requireAuth, (req: Request, res: Response, next: NextFunction) => {
  if (!env.slackClientId || !env.slackClientSecret) {
    res.status(500).json({ error: "Slack OAuth is not configured. Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET." });
    return;
  }
  cleanupStates();
  const state = crypto.randomBytes(16).toString("hex");
  pendingStates.set(state, { userId: req.user!.id, expiresAt: Date.now() + STATE_TTL });

  const origin = `${req.protocol}://${req.get("host")}`;
  res.redirect(slackAuthorizeUrlFor(origin, state));
});

// GET /api/slack/callback → exchange code, store token per user
router.get("/callback", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code, state, error } = req.query as Record<string, string | undefined>;
    if (error) {
      res.redirect(`${env.frontendUrl}/dashboard?slack=denied`);
      return;
    }
    const pending = state ? pendingStates.get(state) : undefined;
    if (!code || !pending) {
      res.redirect(`${env.frontendUrl}/dashboard?slack=invalid_state`);
      return;
    }
    pendingStates.delete(state!);

    const origin = `${req.protocol}://${req.get("host")}`;
    const tokens = await exchangeSlackCode(code, origin);
    console.log("[slack] oauth exchange returned scopes:", tokens.scope, "bot_id:", tokens.bot_user_id);
    if (!tokens.ok || !tokens.access_token) {
      console.error("[slack] oauth exchange failed:", tokens.error);
      res.redirect(`${env.frontendUrl}/dashboard?slack=exchange_failed`);
      return;
    }

    const channel = await findBotChannel(tokens.access_token);
    if (!channel) {
      res.redirect(`${env.frontendUrl}/dashboard?slack=no_channel`);
      return;
    }

    await saveSlackIntegration(
      pending.userId,
      tokens.access_token,
      channel.channelId,
      tokens.team?.name ?? null,
      tokens.scope ?? null
    );
    console.log(`[slack] user ${pending.userId} connected Slack (team: ${tokens.team?.name}, channel: ${channel.name})`);
    res.redirect(`${env.frontendUrl}/dashboard?slack=connected`);
  } catch (err) {
    console.error("[slack] callback error:", err);
    res.redirect(`${env.frontendUrl}/dashboard?slack=error`);
  }
});

// GET /api/slack/status
router.get("/status", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  const integration = await getSlackIntegration(req.user!.id);
  res.json({
    connected: integration !== null,
    teamName: integration?.teamName ?? null,
    scopes: integration?.scopes ?? null,
  });
});

// POST /api/slack/disconnect
router.post("/disconnect", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await deleteSlackIntegration(req.user!.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
