import { Client } from "@elastic/elasticsearch";
import { env } from "../config/env";

/**
 * Elasticsearch integration.
 * - `emails` index, documents indexed on email create + status change.
 * - Fire-and-forget: indexing failures never block or fail an email send.
 * - The whole module degrades gracefully: if ES is unreachable, search
 *   returns a 503 and everything else keeps working.
 */

export const esClient = new Client({ node: env.elasticsearchUrl, requestTimeout: 5000 });

export const EMAILS_INDEX = "emails";

let esAvailable: boolean | null = null;
let lastCheckedAt = 0;

export async function isElasticsearchAvailable(force = false): Promise<boolean> {
  const now = Date.now();
  if (!force && esAvailable !== null && now - lastCheckedAt < 30_000) return esAvailable;
  try {
    await esClient.ping();
    esAvailable = true;
  } catch {
    esAvailable = false;
  }
  lastCheckedAt = now;
  return esAvailable;
}

export interface EmailDoc {
  id: string;
  userId: string;
  campaignId: string;
  campaignName?: string;
  recipient: string;
  subject: string;
  body: string;
  status: string;
  scheduledAt: string;
  sentAt: string | null;
  error?: string | null;
}

export async function ensureEmailsIndex(): Promise<void> {
  if (!(await isElasticsearchAvailable(true))) {
    console.warn("[es] not available — search disabled, indexing skipped until it comes back");
    return;
  }
  const exists = await esClient.indices.exists({ index: EMAILS_INDEX });
  if (exists) return;
  await esClient.indices.create({
    index: EMAILS_INDEX,
    settings: {
      analysis: {
        analyzer: {
          email_analyzer: {
            type: "custom",
            tokenizer: "uax_url_email",
            filter: ["lowercase"],
          },
        },
      },
    },
    mappings: {
      properties: {
        userId: { type: "keyword" },
        campaignId: { type: "keyword" },
        campaignName: { type: "text" },
        recipient: { type: "text", analyzer: "email_analyzer", fields: { raw: { type: "keyword" } } },
        subject: { type: "text" },
        body: { type: "text" },
        status: { type: "keyword" },
        scheduledAt: { type: "date" },
        sentAt: { type: "date" },
        error: { type: "text" },
      },
    },
  });
  console.log(`[es] created index "${EMAILS_INDEX}"`);
}

export async function indexEmail(doc: EmailDoc): Promise<void> {
  try {
    if (!(await isElasticsearchAvailable())) return;
    await esClient.index({ index: EMAILS_INDEX, id: doc.id, document: doc, refresh: "wait_for" });
  } catch (err) {
    // Never let search indexing break email delivery.
    console.warn(`[es] failed to index email ${doc.id}:`, (err as Error).message);
  }
}

export async function deleteEmailDoc(id: string): Promise<void> {
  try {
    if (!(await isElasticsearchAvailable())) return;
    await esClient.delete({ index: EMAILS_INDEX, id }, { ignore: [404] });
  } catch {
    /* ignore */
  }
}

export interface SearchHit {
  id: string;
  recipient: string;
  subject: string;
  status: string;
  scheduledAt: string;
  sentAt: string | null;
  campaignId: string;
  campaignName?: string;
  error?: string | null;
}

export async function searchEmails(userId: string, q: string, size = 50): Promise<SearchHit[]> {
  if (!(await isElasticsearchAvailable())) {
    throw Object.assign(new Error("Elasticsearch is not available"), { statusCode: 503 });
  }
  const res = await esClient.search({
    index: EMAILS_INDEX,
    size,
    query: {
      bool: {
        filter: [{ term: { userId } }],
        should: [
          {
            multi_match: {
              query: q,
              fields: ["recipient", "recipient.raw", "subject^2", "body"],
              fuzziness: "AUTO",
            },
          },
          { wildcard: { "recipient.raw": { value: `*${q.toLowerCase()}*` } } },
        ],
        minimum_should_match: 1,
      },
    },
    sort: [{ sentAt: { order: "desc", missing: "_last" } }, { scheduledAt: { order: "desc" } }],
  });

  return res.hits.hits.map((h) => h._source as SearchHit);
}

/** Re-index any rows not yet in ES (called on boot after ES becomes available). */
export async function reconcileMissingDocs(): Promise<void> {
  if (!(await isElasticsearchAvailable())) return;
  const { prisma } = await import("../lib/prisma");
  // Only emails that are sent/failed need reconciliation on boot — scheduled
  // ones get indexed as they change state.
  const rows = await prisma.email.findMany({
    where: { status: { in: ["sent", "failed"] } },
    include: { campaign: { select: { name: true } } },
    take: 1000,
  });
  for (const r of rows) {
    try {
      const exists = await esClient.exists({ index: EMAILS_INDEX, id: r.id });
      if (!exists) {
        await indexEmail(toDoc(r));
      }
    } catch {
      /* best effort */
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toDoc(r: any): EmailDoc {
  return {
    id: r.id,
    userId: r.userId,
    campaignId: r.campaignId,
    campaignName: r.campaign?.name,
    recipient: r.recipient,
    subject: r.subject,
    body: r.body,
    status: r.status,
    scheduledAt: r.scheduledAt instanceof Date ? r.scheduledAt.toISOString() : r.scheduledAt,
    sentAt: r.sentAt ? (r.sentAt instanceof Date ? r.sentAt.toISOString() : r.sentAt) : null,
    error: r.error,
  };
}
