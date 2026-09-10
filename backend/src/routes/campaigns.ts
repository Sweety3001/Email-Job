import { Router, Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import { requireAuth } from "../middleware/auth";
import { scheduleCampaign } from "../services/scheduler";

const router = Router();
router.use(requireAuth);

interface CreateCampaignBody {
  name?: string;
  subject: string;
  body: string;
  recipients: string[];
  startTime: string; // ISO
  delaySeconds?: number;
  hourlyLimit?: number;
}

// Mounted at /api/campaigns
router.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const b = req.body as CreateCampaignBody;
    if (!b?.subject?.trim() || !b?.body?.trim()) {
      res.status(400).json({ error: "Subject and body are required" });
      return;
    }
    if (!Array.isArray(b.recipients) || b.recipients.length === 0) {
      res.status(400).json({ error: "Recipients list is required (upload a CSV or paste emails)" });
      return;
    }
    const startTime = new Date(b.startTime);
    if (Number.isNaN(startTime.getTime())) {
      res.status(400).json({ error: "startTime must be a valid ISO date string" });
      return;
    }
    const delaySeconds = b.delaySeconds !== undefined ? Number(b.delaySeconds) : 5;
    if (!Number.isFinite(delaySeconds) || delaySeconds < 0) {
      res.status(400).json({ error: "delaySeconds must be a non-negative number" });
      return;
    }

    const result = await scheduleCampaign({
      userId: req.user!.id,
      name: b.name,
      subject: b.subject,
      body: b.body,
      recipients: b.recipients,
      startTime,
      delaySeconds,
      hourlyLimit: b.hourlyLimit,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const campaigns = await prisma.campaign.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        subject: true,
        startTime: true,
        delaySeconds: true,
        status: true,
        totalRecipients: true,
        sentCount: true,
        failedCount: true,
        createdAt: true,
      },
    });
    res.json({ campaigns });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const campaign = await prisma.campaign.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
      include: {
        emails: {
          orderBy: { scheduledAt: "asc" },
          select: {
            id: true,
            recipient: true,
            subject: true,
            status: true,
            scheduledAt: true,
            sentAt: true,
            error: true,
            previewUrl: true,
          },
        },
      },
    });
    if (!campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    res.json({ campaign });
  } catch (err) {
    next(err);
  }
});

export default router;
