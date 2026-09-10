import Redis from "ioredis";
import { env } from "../config/env";

// Shared connection for general Redis ops (counters, locks).
// BullMQ creates and manages its own connections.
export const redis = new Redis(env.redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});

redis.on("error", (err) => {
  // BullMQ + ioredis keep retrying; just log, never crash the process.
  console.error("[redis] connection error:", err.message);
});

redis.on("connect", () => {
  console.log("[redis] connected");
});
