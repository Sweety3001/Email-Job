import { Router, Request, Response, NextFunction } from "express";
import { requireAuth } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import { getEmailQueue } from "../lib/queues";
import { currentCount } from "../services/rateLimiter";
import { env } from "../config/env";
import { isElasticsearchAvailable } from "../services/search";
import { getSlackIntegration } from "../services/slack";

const router = Router();
router.use(requireAuth);

// Mounted at /api/stats
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const queue = getEmailQueue();

    const [scheduled, sending, sent, failed, queueCounts, globalRate, slack] = await Promise.all([
      prisma.email.count({ where: { userId, status: "scheduled" } }),
      prisma.email.count({ where: { userId, status: "sending" } }),
      prisma.email.count({ where: { userId, status: "sent" } }),
      prisma.email.count({ where: { userId, status: "failed" } }),
      queue.getJobCounts("waiting", "delayed", "active", "failed", "completed"),
      currentCount("global"),
      getSlackIntegration(userId),
    ]);

    res.json({
      emails: { scheduled, sending, sent, failed },
      queue: {
        waiting: queueCounts.waiting ?? 0,
        delayed: queueCounts.delayed ?? 0,
        active: queueCounts.active ?? 0,
        failed: queueCounts.failed ?? 0,
        completed: queueCounts.completed ?? 0,
      },
      rate: {
        globalCountThisHour: globalRate,
        maxEmailsPerHour: env.maxEmailsPerHour,
        maxEmailsPerHourPerSender: env.maxEmailsPerHourPerSender,
        mode: env.rateLimitMode,
        minDelayMs: env.minDelayMs,
        workerConcurrency: env.emailWorkerConcurrency,
      },
      slackConnected: slack !== null,
      elasticsearchAvailable: await isElasticsearchAvailable(),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
