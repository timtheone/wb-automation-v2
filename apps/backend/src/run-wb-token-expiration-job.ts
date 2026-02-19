import {
  createCheckWbTokenExpirationService,
  toErrorMessage,
  type WbTokenExpirationWarning
} from "@wb-automation-v2/core";
import { getDatabaseClient } from "@wb-automation-v2/db";

import { createLogger, getBackendLogFilePath } from "./logger.js";
import { createTelegramDeliveryService } from "./services/telegram-delivery-service.js";
import { createBackendTenantService } from "./services/tenant-service.js";

const logger = createLogger({ component: "wb-token-expiration-job" });
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
  let aggregateWarnings = 0;
  let aggregateInvalidTokens = 0;
  let aggregateExpiredTokens = 0;

  for (const tenantContext of tenantContexts) {
    logger.info(
      {
        tenantId: tenantContext.tenantId,
        ownerTelegramUserId: tenantContext.ownerTelegramUserId
      },
      "tenant token-expiration check started"
    );

    const service = createCheckWbTokenExpirationService({
      tenantId: tenantContext.tenantId,
      warningThresholdDays: 4
    });

    const result = await service.checkWbTokenExpiration();

    aggregateProcessedShops += result.processedShops;
    aggregateWarnings += result.warnings.length;
    aggregateInvalidTokens += result.invalidTokens.length;
    aggregateExpiredTokens += result.expiredTokensCount;

    logger.info(
      {
        tenantId: tenantContext.tenantId,
        ownerTelegramUserId: tenantContext.ownerTelegramUserId,
        processedShops: result.processedShops,
        warningsCount: result.warnings.length,
        invalidTokensCount: result.invalidTokens.length,
        expiredTokensCount: result.expiredTokensCount,
        warningShops: result.warnings.map(toWarningLogItem),
        invalidTokens: result.invalidTokens
      },
      "tenant token-expiration check completed"
    );

    if (result.warnings.length > 0) {
      await telegramDelivery.sendWbTokenExpirationWarnings(tenantContext.ownerTelegramUserId, result.warnings);
    }
  }

  logger.info(
    {
      tenantsProcessed: tenantContexts.length,
      processedShops: aggregateProcessedShops,
      warningsCount: aggregateWarnings,
      invalidTokensCount: aggregateInvalidTokens,
      expiredTokensCount: aggregateExpiredTokens,
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

function toWarningLogItem(item: WbTokenExpirationWarning): {
  shopId: string;
  shopName: string;
  daysLeft: number;
  expiresAt: string;
} {
  return {
    shopId: item.shopId,
    shopName: item.shopName,
    daysLeft: item.daysLeft,
    expiresAt: item.expiresAt.toISOString()
  };
}

async function closeDatabaseConnection() {
  const client = getDatabaseClient() as { end?: () => unknown | Promise<unknown> };

  if (typeof client.end === "function") {
    await client.end();
  }
}
