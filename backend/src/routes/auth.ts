import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import { signToken } from "../middleware/auth";

const router = Router();

/**
 * Real Google OAuth 2.0 (no mocks).
 *  1. GET /api/auth/google           → redirect to Google consent
 *  2. GET /api/auth/google/callback  → code exchange → upsert user → JWT cookie
 *  3. GET  /api/auth/me              → current user (name, email, avatar)
 *  4. POST /api/auth/logout          → clear cookie
 */

router.get("/google", async (req: Request, res: Response) => {
  if (!env.googleClientId) {
    // MOCK LOGIN FOR DEMO PURPOSES
    const user = await prisma.user.upsert({
      where: { googleId: "mock-user-123" },
      create: {
        googleId: "mock-user-123",
        email: "demo@reachinbox.com",
        name: "Demo User",
        avatarUrl: "https://ui-avatars.com/api/?name=Demo+User",
      },
      update: {},
    });
    res.cookie("reachinbox_token", signToken({ id: user.id, email: user.email, name: user.name }), {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.redirect(`${env.frontendUrl}/dashboard`);
    return;
  }
  const params = new URLSearchParams({
    client_id: env.googleClientId,
    redirect_uri: `${req.protocol}://${req.get("host")}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    prompt: "select_account",
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

interface GoogleTokenResponse {
  access_token?: string;
  id_token?: string;
  error?: string;
}

interface GoogleUserInfo {
  sub: string;
  email: string;
  name: string;
  picture?: string;
  email_verified?: boolean;
}

router.get("/google/callback", async (req: Request, res: Response) => {
  const code = req.query.code as string | undefined;
  const error = req.query.error as string | undefined;
  if (error || !code) {
    res.redirect(`${env.frontendUrl}/login?error=${encodeURIComponent(error ?? "missing_code")}`);
    return;
  }
  try {
    const redirectUri = `${req.protocol}://${req.get("host")}/api/auth/google/callback`;

    // Exchange code for tokens.
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.googleClientId,
        client_secret: env.googleClientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const tokens = (await tokenRes.json()) as GoogleTokenResponse;
    if (!tokens.access_token) {
      console.error("[auth] token exchange failed:", tokens.error);
      res.redirect(`${env.frontendUrl}/login?error=token_exchange_failed`);
      return;
    }

    // Fetch the profile.
    const profileRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = (await profileRes.json()) as GoogleUserInfo;
    if (!profile.sub || !profile.email) {
      res.redirect(`${env.frontendUrl}/login?error=profile_fetch_failed`);
      return;
    }

    // Upsert the user.
    const user = await prisma.user.upsert({
      where: { googleId: profile.sub },
      create: {
        googleId: profile.sub,
        email: profile.email,
        name: profile.name || profile.email,
        avatarUrl: profile.picture,
      },
      update: {
        email: profile.email,
        name: profile.name || profile.email,
        avatarUrl: profile.picture,
      },
    });

    res.cookie("reachinbox_token", signToken({ id: user.id, email: user.email, name: user.name }), {
      httpOnly: true,
      secure: false, // localhost demo; true behind HTTPS
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.redirect(`${env.frontendUrl}/dashboard`);
  } catch (err) {
    console.error("[auth] google callback error:", err);
    res.redirect(`${env.frontendUrl}/login?error=callback_error`);
  }
});

router.post("/logout", (req: Request, res: Response) => {
  res.clearCookie("reachinbox_token");
  res.json({ ok: true });
});

export default router;
