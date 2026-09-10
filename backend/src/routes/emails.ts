import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { searchEmails, isElasticsearchAvailable } from "../services/search";

const router = Router();
router.use(requireAuth);

// Mounted at /api/emails
// GET /api/emails?status=scheduled|sending|sent|failed&page=1&pageSize=20&campaignId=
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = req.query.status as string | undefined;
    const campaignId = req.query.campaignId as string | undefined;
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
    const pageSize = Math.min(100, Math.max(5, parseInt(String(req.query.pageSize ?? "20"), 10) || 20));

    const where = {
      userId: req.user!.id,
      ...(status ? { status } : {}),
      ...(campaignId ? { campaignId } : {}),
    };

    const [total, emails] = await Promise.all([
      prisma.email.count({ where }),
      prisma.email.findMany({
        where,
        orderBy: [{ scheduledAt: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          recipient: true,
          subject: true,
          status: true,
          scheduledAt: true,
          sentAt: true,
          error: true,
          previewUrl: true,
          attempts: true,
          campaignId: true,
          campaign: { select: { name: true } },
        },
      }),
    ]);

    res.json({ total, page, pageSize, emails });
  } catch (err) {
    next(err);
  }
});

// GET /api/emails/search?q=... (Elasticsearch)
router.get("/search", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (!q) {
      res.status(400).json({ error: "Query parameter q is required" });
      return;
    }
    if (!(await isElasticsearchAvailable())) {
      res.status(503).json({ error: "Elasticsearch is not available. Start it with: docker compose up -d elasticsearch" });
      return;
    }
    const results = await searchEmails(req.user!.id, q);
    res.json({ query: q, results });
  } catch (err) {
    next(err);
  }
});

export default router;
