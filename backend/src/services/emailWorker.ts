import { Worker, Job, DelayedError } from "bullmq";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import { createQueueConnectionForWorker } from "../lib/queues";
import { sendEmail } from "./senders";
import { tryConsumeSendSlot, tryConsumeCampaignSlot, wouldExceedLimit, campaignWouldExceed, acquireThrottle, throttleKey, RateDecision } from "./rateLimiter";
import { indexEmail, toDoc } from "./search";
import { notifyRateLimitHit } from "./slack";
import { reconcileOnBoot } from "./scheduler";

/**
 * Email dispatch worker.
 *
 * Per-job flow (all safety-critical steps are idempotent or atomic):
 *  1. Load the email row. If already `sent` → return (duplicate job, no-op).
 *  2. Atomically flip status `scheduled → sending` via updateMany
 *     (only succeeds once — concurrent workers can't double-send).
 *     A job that finds the row already `sending` (e.g. crash mid-send)
 *     is retried by BullMQ's attempts/backoff — the flip is retried, not
 *     the send, until the status transition succeeds.
 *  3. Peek hourly limits BEFORE consuming an attempt; if the hour is
 *     already exhausted, move the job to the next hour window (order
 *     preserved by staggering on email id) and return.
 *  4. Acquire the min-delay throttle lock (Redis SET NX PX). If held,
 *     delay the job by the remaining TTL — never drop.
 *  5. Consume a send slot (atomic INCR). If the limit is hit right now,
 *     move to next window + fire the Slack notification (once per
 *     scope+window).
 *  6. Send via Ethereal SMTP. On success: status=sent, previewUrl,
 *     index in ES. On failure: BullMQ retries with backoff; after the
 *     final attempt, status=failed.
 */

async function moveToNextHour(job: Job, decision: RateDecision, emailId: string): Promise<void> {
  // Stagger within the next window to preserve ordering across re-scheduled jobs.
  // Hash the email id into a stable 0-1000ms offset so relative order is kept
  // roughly intact without all jobs landing on the exact same millisecond.
  let hash = 0;
  for (let i = 0; i < emailId.length; i++) hash = (hash * 31 + emailId.charCodeAt(i)) >>> 0;
  const stagger = hash % 1000;
  const delayUntil = decision.nextWindowStart + stagger;

  const delay = Math.max(1000, delayUntil - Date.now());
  console.log(
    `[worker] rate limit hit (${decision.scope}, ${decision.currentCount}/${decision.limit}) — moving email ${emailId} to next hour window (in ${Math.round(delay / 1000)}s)`
  );

  // Fire Slack notification (once per scope+window; no-op if not connected).
  await notifyRateLimitHit(decision).catch((err) =>
    console.warn("[worker] slack notification failed:", (err as Error).message)
  );

  await job.moveToDelayed(delayUntil, job.token);
  throw new DelayedError();
}

async function delayByMs(job: Job, ms: number): Promise<void> {
  await job.moveToDelayed(Date.now() + ms, job.token);
  throw new DelayedError();
}

async function processEmail(job: Job<{ emailId: string }>): Promise<{ status: string }> {
  const emailId = job.data.emailId;

  // 1. Load and short-circuit duplicates/completed dispatches.
  const email = await prisma.email.findUnique({
    where: { id: emailId },
    include: { sender: true, campaign: { select: { id: true, name: true, hourlyLimit: true } } },
  });
  if (!email) return { status: "missing" }; // row deleted — nothing to do
  if (email.status === "sent") return { status: "already-sent" }; // idempotency
  if (email.status === "failed") return { status: "already-failed" };

  if (email.status === "sending" && email.updatedAt.getTime() > Date.now() - 60_000) {
    // Another worker (or a crashed attempt <60s ago) holds this email.
    // Signal BullMQ to retry later rather than double-send.
    await delayByMs(job, 5_000);
  }

  if (!email.sender) {
    throw new Error(`Email ${emailId} has no sender assigned`);
  }
  const senderId = email.sender.id;

  // 2. Peek hourly limits BEFORE status flip or consuming attempt.
  const peeked = (await wouldExceedLimit(senderId)) ?? (await campaignWouldExceed(email.campaignId, email.campaign.hourlyLimit ?? 0));
  if (peeked) {
    await moveToNextHour(job, peeked, emailId);
  }

  // 3. Min-delay throttle lock (Redis PX).
  const wait = await acquireThrottle(throttleKey(senderId));
  if (wait > 0) {
    await delayByMs(job, wait + 50);
  }

  // 4. Consume a send slot (atomic counter): global/sender first, then
  //    the campaign's own hourly limit if one was set.
  const decision =
    (await tryConsumeSendSlot(senderId)) ??
    (await tryConsumeCampaignSlot(email.campaignId, email.campaign.hourlyLimit ?? 0));
  if (decision) {
    await moveToNextHour(job, decision, emailId);
  }

  // 5. Atomic status flip scheduled → sending (only when ready for dispatch).
  const flipped = await prisma.email.updateMany({
    where: { id: emailId, status: "scheduled" },
    data: { status: "sending", attempts: { increment: 1 } },
  });
  if (flipped.count === 0) {
    // Status wasn't `scheduled`: either `sending` (handled above / retry),
    // or already sent/failed.
    const fresh = await prisma.email.findUnique({ where: { id: emailId }, select: { status: true } });
    if (fresh?.status === "sent") return { status: "already-sent" };
    if (fresh?.status === "failed") return { status: "already-failed" };
    // `sending` with stale updatedAt (crashed mid-send >60s ago) — re-flip is
    // safe because we re-read state; proceed to send.
    if (fresh?.status !== "sending") return { status: `skipped-${fresh?.status ?? "unknown"}` };
  }

  // 6. Send via Ethereal SMTP. On success: status=sent, previewUrl,
  //    index in ES. On failure: BullMQ retries with backoff; after the
  //    final attempt, status=failed.
  try {
    const { previewUrl } = await sendEmail({
      sender: email.sender,
      to: email.recipient,
      subject: email.subject,
      body: email.body,
    });
    const sentAt = new Date();
    await prisma.email.update({
      where: { id: emailId },
      data: { status: "sent", sentAt, previewUrl },
    });
    await indexEmail(toDoc({ ...email, status: "sent", sentAt }));
    console.log(`[worker] sent email ${emailId} → ${email.recipient}${previewUrl ? ` (preview: ${previewUrl})` : ""}`);
    await updateCampaignCounts(email.campaignId);
    return { status: "sent" };
  } catch (err) {
    const isFinalAttempt = job.attemptsMade >= job.opts.attempts!;
    await prisma.email.update({
      where: { id: emailId },
      data: { status: isFinalAttempt ? "failed" : "scheduled", error: (err as Error).message.slice(0, 500) },
    });
    if (isFinalAttempt) {
      await indexEmail(toDoc({ ...email, status: "failed", error: (err as Error).message }));
      console.error(`[worker] email ${emailId} FAILED permanently:`, (err as Error).message);
      await updateCampaignCounts(email.campaignId);
      return { status: "failed" };
    }
    // Non-final: back to scheduled so the atomic-flip guard works on retry.
    throw err;
  }
}

async function updateCampaignCounts(campaignId: string): Promise<void> {
  try {
    const [sent, failed, total] = await Promise.all([
      prisma.email.count({ where: { campaignId, status: "sent" } }),
      prisma.email.count({ where: { campaignId, status: "failed" } }),
      prisma.email.count({ where: { campaignId } }),
    ]);
    const status = failed + sent >= total ? (failed > 0 && sent === 0 ? "failed" : "completed") : "running";
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { sentCount: sent, failedCount: failed, status },
    });
  } catch (err) {
    console.warn("[worker] failed to update campaign counts:", (err as Error).message);
  }
}

export function startEmailWorker(): Worker {
  console.log(
    `[worker] starting — concurrency=${env.emailWorkerConcurrency}, minDelay=${env.minDelayMs}ms, ` +
      `limits: global=${env.maxEmailsPerHour || "∞"}/h per-sender=${env.maxEmailsPerHourPerSender || "∞"}/h (mode=${env.rateLimitMode})`
  );

  const worker = new Worker<{ emailId: string }>(
    env.emailQueueName,
    processEmail,
    {
      connection: createQueueConnectionForWorker(),
      concurrency: env.emailWorkerConcurrency,
    }
  );

  worker.on("failed", (job, err) => {
    // DelayedError is the normal "moved to future" control-flow path.
    if (!(err instanceof DelayedError)) {
      console.error(`[worker] job ${job?.id} failed (attempt ${job?.attemptsMade}):`, err.message);
    }
  });
  worker.on("error", (err) => console.error("[worker] worker error:", err.message));

  return worker;
}

async function main() {
  console.log("[worker] boot: ensuring senders seeded, reconciling queue state...");
  // Import lazily to avoid a circular import at module load.
  const { ensureSendersSeeded } = await import("./senders");
  await ensureSendersSeeded();
  await reconcileOnBoot();
  const { ensureEmailsIndex, reconcileMissingDocs } = await import("./search");
  await ensureEmailsIndex();
  await reconcileMissingDocs().catch(() => undefined);
  startEmailWorker();
  console.log("[worker] ready");
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[worker] fatal:", err);
    process.exit(1);
  });
}

export { main as startWorkerProcess };
