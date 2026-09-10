import { Router, Request, Response, NextFunction } from "express";
import { requireAuth } from "../middleware/auth";
import { listSenders } from "../services/senders";

const router = Router();
router.use(requireAuth);

// Mounted at /api/senders
router.get("/", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const senders = await listSenders();
    res.json({ senders });
  } catch (err) {
    next(err);
  }
});

export default router;
