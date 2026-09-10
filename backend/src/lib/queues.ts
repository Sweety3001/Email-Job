import IORedis from "ioredis";
import { Queue } from "bullmq";
import { env } from "../config/env";

// The single email dispatch queue. Jobs carry only the email row id;
// the worker always re-reads state from Postgres before acting.

export interface EmailJobData {
  emailId: string;
}

function createQueueConnection(): IORedis {
  // BullMQ requires maxRetriesPerRequest: null on its connections.
  return new IORedis(env.redisUrl, { maxRetriesPerRequest: null });
}

let emailQueue: Queue | null = null;

/** Singleton queue instance (one Redis connection per process). */
export function getEmailQueue(): Queue {
  if (!emailQueue) {
    emailQueue = new Queue(env.emailQueueName, {
      connection: createQueueConnection(),
      defaultJobOptions: {
        // Keep completed/failed jobs inspectable in bull-board without
        // growing forever.
        removeOnComplete: { age: 3600, count: 5000 },
        removeOnFail: { age: 86400, count: 20000 },
        attempts: 5,
        backoff: { type: "exponential", delay: 5000 },
      },
    });
  }
  return emailQueue;
}

export function createQueueConnectionForWorker(): IORedis {
  return createQueueConnection();
}
