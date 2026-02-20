import { createSyncContentShopsService, toErrorMessage } from "@wb-automation-v2/core";
import { createJobRunRepository, getDatabaseClient } from "@wb-automation-v2/db";

import { createLogger, getBackendLogFilePath } from "./logger.js";
import { createBackendTenantService } from "./services/tenant-service.js";
import { createTelegramDeliveryService } from "./services/telegram-delivery-service.js";

const logger = createLogger({ component: "sync-content-job" });
const tenantService = createBackendTenantService();
const telegramDelivery = createTelegramDeliveryService();

const startedAt = new Date();
logger.info({ startedAt: startedAt.toISOString(), logFilePath: getBackendLogFilePath() }, "job started");

try {
  const tenantContexts = await tenantService.listTenantContexts();

  if (tenantContexts.length === 0) {
    logger.info({ durationMs: Date.now() - startedAt.getTime() }, "job completed: no tenants configured");
    await closeDatabaseConnection();
    process.exit(0);
  }

  let aggregateProcessedShops = 0;
  let aggregateSuccessCount = 0;
  let aggregateFailureCount = 0;
  let aggregateCardsUpserted = 0;
  const pendingFailureSummaries: Array<{
    tenantId: string;
    chatId: number;
    summary: {
      processedShops: number;
      successCount: number;
      failureCount: number;
      totalCardsUpserted: number;
      failedShops: Array<{
        shopId: string;
        shopName: string;
        error: string;
      }>;
    };
  }> = [];

  for (const tenantContext of tenantContexts) {
    const tenantStartedAt = new Date();
    const jobRunRepository = createJobRunRepository({ tenantId: tenantContext.tenantId });
    const tenantJobRunId = await jobRunRepository.start({
      jobType: "sync_content_shops",
      startedAt: tenantStartedAt,
      details: {
        source: "scheduler.sync-content",
        ownerTelegramUserId: tenantContext.ownerTelegramUserId
      }
    });

    logger.info(
      {
        tenantId: tenantContext.tenantId,
        ownerTelegramUserId: tenantContext.ownerTelegramUserId
      },
      "tenant sync started"
    );

    const syncContentShopsService = createSyncContentShopsService({
      tenantId: tenantContext.tenantId,
      onWbCardsListResponse(input) {
        logger.info(
          {
            tenantId: tenantContext.tenantId,
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

    try {
      const result = await syncContentShopsService.syncContentShops();

      aggregateProcessedShops += result.processedShops;
      aggregateSuccessCount += result.successCount;
      aggregateFailureCount += result.failureCount;
      aggregateCardsUpserted += result.totalCardsUpserted;

      const finishedAt = new Date();

      await jobRunRepository.markSuccess({
        jobRunId: tenantJobRunId,
        finishedAt,
        details: {
          source: "scheduler.sync-content",
          ownerTelegramUserId: tenantContext.ownerTelegramUserId,
          processedShops: result.processedShops,
          successCount: result.successCount,
          failureCount: result.failureCount,
          totalCardsUpserted: result.totalCardsUpserted,
          durationMs: finishedAt.getTime() - tenantStartedAt.getTime()
        }
      });

      logger.info(
        {
          tenantId: tenantContext.tenantId,
          ownerTelegramUserId: tenantContext.ownerTelegramUserId,
          processedShops: result.processedShops,
          successCount: result.successCount,
          failureCount: result.failureCount,
          totalCardsUpserted: result.totalCardsUpserted
        },
        "tenant sync completed"
      );

      const failedShops = result.results.flatMap((item) =>
        item.status === "failed" && item.error !== null
          ? [
              {
                shopId: item.shopId,
                shopName: item.shopName,
                error: item.error
              }
            ]
          : []
      );

      if (failedShops.length > 0) {
        pendingFailureSummaries.push({
          tenantId: tenantContext.tenantId,
          chatId: tenantContext.ownerTelegramUserId,
          summary: {
            processedShops: result.processedShops,
            successCount: result.successCount,
            failureCount: result.failureCount,
            totalCardsUpserted: result.totalCardsUpserted,
            failedShops
          }
        });
      }
    } catch (error) {
      const finishedAt = new Date();
      const errorMessage = toErrorMessage(error);

      await jobRunRepository.markFailed({
        jobRunId: tenantJobRunId,
        error: errorMessage,
        finishedAt,
        details: {
          source: "scheduler.sync-content",
          ownerTelegramUserId: tenantContext.ownerTelegramUserId,
          durationMs: finishedAt.getTime() - tenantStartedAt.getTime()
        }
      });

      throw error;
    }
  }

  for (const pendingSummary of pendingFailureSummaries) {
    try {
      await telegramDelivery.sendSyncContentShopsFailureSummary(
        pendingSummary.chatId,
        pendingSummary.summary,
        null
      );
      logger.info(
        {
          tenantId: pendingSummary.tenantId,
          chatId: pendingSummary.chatId,
          failureCount: pendingSummary.summary.failureCount
        },
        "sent scheduled sync-content failure summary to telegram"
      );
    } catch (notificationError) {
      logger.error(
        {
          tenantId: pendingSummary.tenantId,
          chatId: pendingSummary.chatId,
          error: toErrorMessage(notificationError)
        },
        "failed to send scheduled sync-content failure summary to telegram"
      );
    }
  }

  logger.info(
    {
      tenantsProcessed: tenantContexts.length,
      processedShops: aggregateProcessedShops,
      successCount: aggregateSuccessCount,
      failureCount: aggregateFailureCount,
      totalCardsUpserted: aggregateCardsUpserted,
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
