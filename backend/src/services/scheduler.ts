import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { getEmailQueue, EmailJobData } from "../lib/queues";
import { listSenders } from "./senders";

/**
 * Campaign creation flow:
 * 1. Create Campaign + Email rows in ONE Prisma transaction.
 *    Per-recipient scheduledAt = startTime + i * delaySeconds.
 *    Unique (campaignId, recipient) prevents duplicates within a campaign.
 * 2. Add a delayed BullMQ job per email, with jobId = `email:{emailRowId}`.
 *    BullMQ REJECTS duplicate custom jobIds, so re-adding the same email is
 *    a no-op — this is the idempotency guarantee against double-queueing.
 */

const emailQueue = getEmailQueue();

export interface ScheduleCampaignInput {
  userId: string;
  name?: string;
  subject: string;
  body: string;
  recipients: string[];
  startTime: Date;
  delaySeconds: number;
  hourlyLimit?: number;
}

export interface ScheduleCampaignResult {
  campaignId: string;
  queued: number;
  skippedDuplicates: number;
  firstSendAt: Date;
  lastSendAt: Date;
}

export async function scheduleCampaign(input: ScheduleCampaignInput): Promise<ScheduleCampaignResult> {
  const { recipients, startTime, delaySeconds } = input;

  // Dedupe + basic validation
  const seen = new Set<string>();
  const validRecipients: string[] = [];
  for (const r of recipients) {
    const email = r.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
    seen.add(email);
    validRecipients.push(email);
  }
  if (validRecipients.length === 0) {
    throw new Error("No valid recipient email addresses provided");
  }

  const result = await prisma.$transaction(async (tx) => {
    const campaign = await tx.campaign.create({
      data: {
        userId: input.userId,
        name: input.name?.trim() || input.subject.slice(0, 60),
        subject: input.subject,
        body: input.body,
        startTime,
        delaySeconds,
        hourlyLimit: input.hourlyLimit ?? null,
        totalRecipients: validRecipients.length,
        status: "scheduled",
      },
    });

    const rows: Prisma.EmailCreateManyInput[] = [];
    for (let i = 0; i < validRecipients.length; i++) {
      rows.push({
        campaignId: campaign.id,
        userId: input.userId,
        recipient: validRecipients[i],
        subject: input.subject,
        body: input.body,
        status: "scheduled",
        scheduledAt: new Date(startTime.getTime() + i * delaySeconds * 1000),
      });
    }

    // Unique constraint dedupes; skipDuplicates makes a retry idempotent.
    const created = await tx.email.createMany({ data: rows, skipDuplicates: true });

    return { campaign, created: created.count };
  });

  // Assign senders round-robin and queue jobs. One grouped query for the
  // whole campaign instead of a per-email query (matters for 1000+ rows).
  const emails = await prisma.email.findMany({
    where: { campaignId: result.campaign.id, status: "scheduled" },
    orderBy: { scheduledAt: "asc" },
    select: { id: true, scheduledAt: true },
  });

  const senders = await listSenders();
  if (senders.length === 0) throw new Error("No senders configured");

  const senderIdByEmailId = new Map<string, string>();
  let next = 0;
  for (const e of emails) {
    senderIdByEmailId.set(e.id, senders[next % senders.length].id);
    next++;
  }

  await prisma.$transaction(
    emails.map((e) =>
      prisma.email.update({
        where: { id: e.id },
        data: { senderId: senderIdByEmailId.get(e.id)! },
      })
    )
  );

  for (const e of emails) {
    await emailQueue.add("send-email", { emailId: e.id } satisfies EmailJobData, {
      jobId: `email-${e.id}`, // idempotency key
      delay: Math.max(0, e.scheduledAt.getTime() - Date.now()),
    });
  }

  const last = emails.length > 0 ? emails[emails.length - 1].scheduledAt : startTime;

  return {
    campaignId: result.campaign.id,
    queued: emails.length,
    skippedDuplicates: validRecipients.length - result.created,
    firstSendAt: startTime,
    lastSendAt: last,
  };
}

/**
 * Boot reconciliation — called when the worker starts.
 * Re-enqueues any email still in `scheduled`/`sending` state that has no
 * live BullMQ job (e.g. Redis was flushed alongside a server restart).
 * Safe to run at any time thanks to jobId dedupe: if the job already
 * exists, BullMQ rejects the duplicate add.
 */
export async function reconcileOnBoot(): Promise<number> {
  // First, reset any emails left trapped in 'sending' state (e.g. from process crashes) back to 'scheduled'
  const resetCount = await prisma.email.updateMany({
    where: { status: "sending" },
    data: { status: "scheduled" },
  });
  if (resetCount.count > 0) {
    console.log(`[reconcile] reset ${resetCount.count} orphaned 'sending' email(s) back to 'scheduled'`);
  }

  const pending = await prisma.email.findMany({
    where: { status: "scheduled" },
    select: { id: true, scheduledAt: true },
    orderBy: { scheduledAt: "asc" },
  });

  let requeued = 0;
  for (const e of pending) {
    // Jobs whose time already passed get delay 0 (send ASAP, preserving order).
    const delay = Math.max(0, e.scheduledAt.getTime() - Date.now());
    await emailQueue.add(
      "send-email",
      { emailId: e.id } satisfies EmailJobData,
      { jobId: `email-${e.id}`, delay }
    );
    requeued++;
  }
  if (requeued > 0) {
    console.log(`[reconcile] ensured ${requeued} pending email job(s) exist in the queue`);
  }
  return requeued;
}
