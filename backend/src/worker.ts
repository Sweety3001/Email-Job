// Worker entrypoint — run separately from the API server:
//   npm run dev:worker
// The API never processes jobs; this process does. Both can be restarted
// independently, and jobs live in Redis (+ reconciled from Postgres).

import { startWorkerProcess } from "./services/emailWorker";

startWorkerProcess().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
