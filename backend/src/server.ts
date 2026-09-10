import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter.js";
import { ExpressAdapter } from "@bull-board/express";
import { env } from "./config/env";
import { warnMissingConfig } from "./config/env";
import { prisma } from "./lib/prisma";
import { getEmailQueue } from "./lib/queues";
import authRoutes from "./routes/auth";
import campaignRoutes from "./routes/campaigns";
import emailRoutes from "./routes/emails";
import senderRoutes from "./routes/senders";
import slackRoutes from "./routes/slack";
import statsRoutes from "./routes/stats";
import { ensureSendersSeeded } from "./services/senders";
import { ensureEmailsIndex } from "./services/search";

async function main() {
  warnMissingConfig();

  const app = express();

  app.use(
    cors({
      origin: env.frontendUrl,
      credentials: true,
    })
  );
  app.use(cookieParser());
  app.use(express.json({ limit: "5mb" })); // large CSV uploads parsed client-side

  // ── Health ────────────────────────────────────────────────────────────
  app.get("/api/health", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ ok: true, service: "reachinbox-api", time: new Date().toISOString() });
    } catch {
      res.status(500).json({ ok: false, error: "database unreachable" });
    }
  });

  // ── /api/auth/me (needs cookie auth, defined before routers) ─────────
  app.get("/api/auth/me", async (req, res) => {
    const token = req.cookies?.["reachinbox_token"];
    if (!token) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    try {
      const payload = jwt.verify(token, env.jwtSecret) as { id: string };
      const user = await prisma.user.findUnique({
        where: { id: payload.id },
        select: { id: true, name: true, email: true, avatarUrl: true },
      });
      if (!user) {
        res.status(401).json({ error: "User not found" });
        return;
      }
      res.json({ user });
    } catch {
      res.status(401).json({ error: "Invalid or expired session" });
    }
  });

  // ── Routers ───────────────────────────────────────────────────────────
  app.use("/api/auth", authRoutes);
  app.use("/api/campaigns", campaignRoutes);
  app.use("/api/emails", emailRoutes);
  app.use("/api/senders", senderRoutes);
  app.use("/api/slack", slackRoutes);
  app.use("/api/stats", statsRoutes);

  // ── Live BullMQ dashboard (queue visibility) ──────────────────────────
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath("/admin/queues");
  const emailQueue = getEmailQueue();
  createBullBoard({
    queues: [new BullMQAdapter(emailQueue as any) as any],
    serverAdapter,
  });
  app.use("/admin/queues", serverAdapter.getRouter());

  // ── 404 + error handler ─────────────────────────────────────────────
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });
  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      console.error("[api] unhandled error:", err);
      res.status(500).json({ error: "Internal server error", detail: err.message });
    }
  );

  // ── Boot tasks (non-blocking for infra that may still be starting) ──
  await ensureSendersSeeded().catch((err) => {
    console.error("[server] sender seeding failed:", err.message);
    process.exit(1);
  });
  await ensureEmailsIndex().catch(() => undefined);

  if (process.env.DISABLE_WORKER !== "true") {
    console.log("[server] Starting embedded email worker process...");
    const { reconcileOnBoot } = await import("./services/scheduler");
    const { startEmailWorker } = await import("./services/emailWorker");
    await reconcileOnBoot().catch((err) => console.warn("[server] boot reconciliation error:", (err as Error).message));
    startEmailWorker();
  }

  app.listen(env.port, () => {
    console.log(`[server] ReachInbox API listening on http://localhost:${env.port}`);
    console.log(`[server] BullMQ dashboard: http://localhost:${env.port}/admin/queues`);
  });
}

main().catch((err) => {
  console.error("[server] fatal:", err);
  process.exit(1);
});
