import nodemailer, { Transporter } from "nodemailer";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";

/**
 * Sender pool. Multiple senders are supported (required by the spec).
 * - If SENDERS env is set, those Ethereal accounts are seeded.
 * - Otherwise, the backend auto-creates 2 Ethereal test accounts on boot
 *   and logs the credentials + preview URL base so they can be inspected.
 *
 * Transports are cached per sender id (Ethereal allows parallel use).
 */

const transports = new Map<string, Transporter>();

export interface SenderRow {
  id: string;
  name: string;
  email: string;
}

function transportFor(sender: { smtpHost: string; smtpPort: number; smtpUser: string; smtpPass: string }): Transporter {
  return nodemailer.createTransport({
    host: sender.smtpHost,
    port: sender.smtpPort,
    secure: sender.smtpPort === 465,
    auth: { user: sender.smtpUser, pass: sender.smtpPass },
  });
}

async function createEtherealAccount(label: string): Promise<Prisma.SenderCreateInput> {
  const acct = await nodemailer.createTestAccount();
  console.log(
    `[senders] Auto-created Ethereal account "${label}": ${acct.user} / ${acct.pass} — preview URL base: https://ethereal.email/messages`
  );
  return {
    name: label,
    email: acct.user,
    smtpHost: "smtp.ethereal.email",
    smtpPort: 587,
    smtpUser: acct.user,
    smtpPass: acct.pass,
  };
}

export async function ensureSendersSeeded(): Promise<void> {
  const count = await prisma.sender.count();

  if (count > 0) return;

  let inputs: Prisma.SenderCreateInput[] = [];

  if (env.senders.length > 0) {
    inputs = env.senders.map((s) => ({
      name: s.name,
      email: s.email,
      smtpHost: "smtp.ethereal.email",
      smtpPort: 587,
      smtpUser: s.smtpUser,
      smtpPass: s.smtpPass,
    }));
  } else {
    inputs = [await createEtherealAccount("Sender One"), await createEtherealAccount("Sender Two")];
  }

  await prisma.sender.createMany({ data: inputs, skipDuplicates: true });
  console.log(`[senders] Seeded ${inputs.length} sender(s)`);
}

export async function listSenders(): Promise<SenderRow[]> {
  return prisma.sender.findMany({ where: { active: true }, select: { id: true, name: true, email: true } });
}

/** Round-robin-ish assignment: pick the sender with fewest emails for this campaign. */
export async function pickSender(campaignId: string): Promise<SenderRow> {
  const senders = await listSenders();
  if (senders.length === 0) throw new Error("No senders configured");
  // Count per-sender usage within the campaign, pick the least used (ties → first).
  const counts = await prisma.email.groupBy({
    by: ["senderId"],
    where: { campaignId, senderId: { not: null } },
    _count: { _all: true },
  });
  const map = new Map(counts.map((c) => [c.senderId as string, c._count._all]));
  let best = senders[0];
  let bestCount = map.get(best.id) ?? -1;
  for (const s of senders) {
    const c = map.get(s.id) ?? -1;
    if (c < bestCount) {
      best = s;
      bestCount = c;
    }
  }
  return best;
}

export function getTransport(sender: { id: string; smtpHost: string; smtpPort: number; smtpUser: string; smtpPass: string }): Transporter {
  let t = transports.get(sender.id);
  if (!t) {
    t = transportFor(sender);
    transports.set(sender.id, t);
  }
  return t;
}

export interface SendResult {
  previewUrl: string | null;
}

export async function sendEmail(opts: {
  sender: { id: string; smtpHost: string; smtpPort: number; smtpUser: string; smtpPass: string; email: string; name: string };
  to: string;
  subject: string;
  body: string;
}): Promise<SendResult> {
  const transporter = getTransport(opts.sender);
  const info = await transporter.sendMail({
    from: `"${opts.sender.name}" <${opts.sender.email}>`,
    to: opts.to,
    subject: opts.subject,
    text: opts.body,
    html: opts.body.replace(/\n/g, "<br/>"),
  });
  return { previewUrl: nodemailer.getTestMessageUrl(info) || null };
}
