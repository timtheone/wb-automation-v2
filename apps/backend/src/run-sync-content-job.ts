import { createSyncContentShopsService, toErrorMessage } from "@wb-automation-v2/core";
import { getDatabaseClient } from "@wb-automation-v2/db";

import { createLogger, getBackendLogFilePath } from "./logger.js";

const logger = createLogger({ component: "sync-content-job" });
const syncContentShopsService = createSyncContentShopsService({
  onWbCardsListResponse(input) {
    logger.info(
      {
        shopId: input.shopId,
        shopName: input.shopName,
        page: input.page,
        apiBaseUrl: input.apiBaseUrl,
        responseUrl: input.responseUrl,
        responseStatus: input.responseStatus
      },
      "wb products cards list call"
    );
  }
});

const startedAt = new Date();
logger.info({ startedAt: startedAt.toISOString(), logFilePath: getBackendLogFilePath() }, "job started");

try {
  const result = await syncContentShopsService.syncContentShops();

  logger.info(
    {
      processedShops: result.processedShops,
      successCount: result.successCount,
      failureCount: result.failureCount,
      totalCardsUpserted: result.totalCardsUpserted,
      durationMs: Date.now() - startedAt.getTime()
    },
    "job completed"
  );

  await closeDatabaseConnection();
  process.exit(0);
} catch (error) {
  logger.error(
    {
      error: toErrorMessage(error),
      durationMs: Date.now() - startedAt.getTime()
    },
    "job failed"
  );

  await closeDatabaseConnection();
  process.exit(1);
}

async function closeDatabaseConnection() {
  const client = getDatabaseClient() as { end?: () => unknown | Promise<unknown> };

  if (typeof client.end === "function") {
    await client.end();
  }
}
