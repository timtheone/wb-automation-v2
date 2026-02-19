import { PgBoss } from "pg-boss";
import {
  createGetCombinedPdfListsService,
  createGetWaitingOrdersPdfListsService,
  createProcessAllShopsService,
  createSyncContentShopsService,
  toErrorMessage,
  type GetCombinedPdfListsResult,
  type ProcessAllShopsResult,
  type SyncContentShopsResult
} from "@wb-automation-v2/core";
import { getDatabase, getDatabaseUrl } from "@wb-automation-v2/db";

import { readRuntimeEnv } from "../config/env.js";
import { createLogger } from "../logger.js";
import { createTelegramDeliveryService } from "./telegram-delivery-service.js";

const COMBINED_PDF_QUEUE_NAME = "flows.get-combined-pdf-lists";
const WAITING_ORDERS_PDF_QUEUE_NAME = "flows.get-waiting-orders-pdf";
const SYNC_CONTENT_QUEUE_NAME = "flows.sync-content-shops";
const COMBINED_PDF_EXPIRE_SECONDS = 60 * 60;
const COMBINED_PDF_DELETE_AFTER_SECONDS = 30 * 60;
const DEFAULT_PG_BOSS_SCHEMA = "pgboss";

type BossJobState = "created" | "retry" | "active" | "completed" | "cancelled" | "failed";

type CombinedPdfBossJob = {
  id: string;
  data?: unknown;
  output?: unknown;
  state?: BossJobState;
  createdOn?: Date | string;
  startedOn?: Date | string | null;
  completedOn?: Date | string | null;
};

interface CombinedPdfJobPayload {
  tenantId: string;
  chatId: number;
  languageCode: string | null;
}

export type CombinedPdfJobStatus = "queued" | "running" | "completed" | "failed";

export interface CombinedPdfJobAccepted {
  jobId: string;
  status: "queued" | "running";
  createdAt: Date;
}

export interface CombinedPdfJobSnapshot {
  jobId: string;
  status: CombinedPdfJobStatus;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
  result: GetCombinedPdfListsResult | null;
}

export class FlowJobNotFoundError extends Error {
  constructor(jobId: string) {
    super(`Flow job not found: ${jobId}`);
    this.name = "FlowJobNotFoundError";
  }
}

export interface BackendFlowsService {
  processAllShops(tenantId: string): Promise<ProcessAllShopsResult>;
  syncContentShops(tenantId: string): Promise<SyncContentShopsResult>;
  startCombinedPdfListsJob(
    tenantId: string,
    chatId: number,
    languageCode: string | null
  ): Promise<CombinedPdfJobAccepted>;
  startWaitingOrdersPdfJob(
    tenantId: string,
    chatId: number,
    languageCode: string | null
  ): Promise<CombinedPdfJobAccepted>;
  startSyncContentShopsJob(
    tenantId: string,
    chatId: number,
    languageCode: string | null
  ): Promise<CombinedPdfJobAccepted>;
  getCombinedPdfListsJob(tenantId: string, jobId: string): Promise<CombinedPdfJobSnapshot>;
}

export function createBackendFlowsService(): BackendFlowsService {
  const db = getDatabase();
  const logger = createLogger({ component: "flows-service" });
  const bossSchema = resolveBossSchema();
  const boss = new PgBoss({
    connectionString: getDatabaseUrl(),
    schema: bossSchema,
    createSchema: true
  });
  const telegramDelivery = createTelegramDeliveryService();

  let setupPromise: Promise<void> | null = null;

  const ensureQueueWorker = async () => {
    if (setupPromise) {
      await setupPromise;
      return;
    }

    setupPromise = initializeBossWorker({ boss, logger, db, telegramDelivery }).catch((error) => {
      setupPromise = null;
      throw error;
    });
    await setupPromise;
  };

  return {
    processAllShops(tenantId) {
      return createProcessAllShopsService({ db, tenantId }).processAllShops();
    },
    syncContentShops(tenantId) {
      return createSyncContentShopsServiceWithProgressLogging({
        db,
        logger,
        tenantId
      }).syncContentShops();
    },
    async startCombinedPdfListsJob(tenantId, chatId, languageCode) {
      await ensureQueueWorker();

      const existingJob = await findActivePdfJobForTenant({
        boss,
        schema: bossSchema,
        queueName: COMBINED_PDF_QUEUE_NAME,
        tenantId
      });

      if (existingJob) {
        return {
          jobId: existingJob.id,
          status: existingJob.state === "active" ? "running" : "queued",
          createdAt: parseDateOrNow(existingJob.createdOn)
        };
      }

      const jobId = crypto.randomUUID();
      const createdAt = new Date();
      const sentJobId = await boss.send(
        COMBINED_PDF_QUEUE_NAME,
        { tenantId, chatId, languageCode },
        {
          id: jobId,
          retryLimit: 0,
          expireInSeconds: COMBINED_PDF_EXPIRE_SECONDS,
          retentionSeconds: COMBINED_PDF_DELETE_AFTER_SECONDS
        }
      );

      if (!sentJobId) {
        throw new Error("Unable to enqueue combined PDF flow job");
      }

      return {
        jobId,
        status: "queued",
        createdAt
      };
    },
    async startWaitingOrdersPdfJob(tenantId, chatId, languageCode) {
      await ensureQueueWorker();

      const existingJob = await findActivePdfJobForTenant({
        boss,
        schema: bossSchema,
        queueName: WAITING_ORDERS_PDF_QUEUE_NAME,
        tenantId
      });

      if (existingJob) {
        return {
          jobId: existingJob.id,
          status: existingJob.state === "active" ? "running" : "queued",
          createdAt: parseDateOrNow(existingJob.createdOn)
        };
      }

      const jobId = crypto.randomUUID();
      const createdAt = new Date();
      const sentJobId = await boss.send(
        WAITING_ORDERS_PDF_QUEUE_NAME,
        { tenantId, chatId, languageCode },
        {
          id: jobId,
          retryLimit: 0,
          expireInSeconds: COMBINED_PDF_EXPIRE_SECONDS,
          retentionSeconds: COMBINED_PDF_DELETE_AFTER_SECONDS
        }
      );

      if (!sentJobId) {
        throw new Error("Unable to enqueue waiting-orders PDF flow job");
      }

      return {
        jobId,
        status: "queued",
        createdAt
      };
    },
    async startSyncContentShopsJob(tenantId, chatId, languageCode) {
      await ensureQueueWorker();

      const existingJob = await findActivePdfJobForTenant({
        boss,
        schema: bossSchema,
        queueName: SYNC_CONTENT_QUEUE_NAME,
        tenantId
      });

      if (existingJob) {
        return {
          jobId: existingJob.id,
          status: existingJob.state === "active" ? "running" : "queued",
          createdAt: parseDateOrNow(existingJob.createdOn)
        };
      }

      const jobId = crypto.randomUUID();
      const createdAt = new Date();
      const sentJobId = await boss.send(
        SYNC_CONTENT_QUEUE_NAME,
        { tenantId, chatId, languageCode },
        {
          id: jobId,
          retryLimit: 0,
          expireInSeconds: COMBINED_PDF_EXPIRE_SECONDS,
          retentionSeconds: COMBINED_PDF_DELETE_AFTER_SECONDS
        }
      );

      if (!sentJobId) {
        throw new Error("Unable to enqueue sync-content-shops flow job");
      }

      return {
        jobId,
        status: "queued",
        createdAt
      };
    },
    async getCombinedPdfListsJob(tenantId, jobId) {
      await ensureQueueWorker();

      const job = (await boss.getJobById(COMBINED_PDF_QUEUE_NAME, jobId)) as CombinedPdfBossJob | null;

      if (!job || readTenantIdFromJob(job) !== tenantId) {
        throw new FlowJobNotFoundError(jobId);
      }

      return mapBossJobToSnapshot(job);
    }
  };
}

async function initializeBossWorker(input: {
  boss: PgBoss;
  logger: ReturnType<typeof createLogger>;
  db: ReturnType<typeof getDatabase>;
  telegramDelivery: ReturnType<typeof createTelegramDeliveryService>;
}) {
  await input.boss.start();

  await registerPdfWorker({
    boss: input.boss,
    logger: input.logger,
    queueName: COMBINED_PDF_QUEUE_NAME,
    flowLabel: "combined-pdf",
    createResult: async ({ tenantId, jobId }) =>
      createGetCombinedPdfListsService({
        db: input.db,
        tenantId,
        onWbApiDebug(event) {
          input.logger.info(
            {
              tenantId,
              jobId,
              event
            },
            "WB combined-pdf API debug"
          );
        }
      }).getCombinedPdfLists(),
    notifySuccess: (chatId, result, languageCode) =>
      input.telegramDelivery.sendCombinedPdfGenerated(chatId, result, languageCode),
    notifyFailure: (chatId, errorMessage, languageCode) =>
      input.telegramDelivery.sendCombinedPdfFailed(chatId, errorMessage, languageCode)
  });

  await registerPdfWorker({
    boss: input.boss,
    logger: input.logger,
    queueName: WAITING_ORDERS_PDF_QUEUE_NAME,
    flowLabel: "waiting-orders-pdf",
    createResult: async ({ tenantId, jobId }) =>
      createGetWaitingOrdersPdfListsService({
        db: input.db,
        tenantId,
        onWbApiDebug(event) {
          input.logger.info(
            {
              tenantId,
              jobId,
              event
            },
            "WB waiting-orders-pdf API debug"
          );
        }
      }).getWaitingOrdersPdfLists(),
    notifySuccess: (chatId, result, languageCode) =>
      input.telegramDelivery.sendWaitingOrdersPdfGenerated(chatId, result, languageCode),
    notifyFailure: (chatId, errorMessage, languageCode) =>
      input.telegramDelivery.sendWaitingOrdersPdfFailed(chatId, errorMessage, languageCode)
  });

  await registerSyncContentWorker({
    boss: input.boss,
    logger: input.logger,
    db: input.db,
    telegramDelivery: input.telegramDelivery
  });
}

async function registerSyncContentWorker(input: {
  boss: PgBoss;
  logger: ReturnType<typeof createLogger>;
  db: ReturnType<typeof getDatabase>;
  telegramDelivery: ReturnType<typeof createTelegramDeliveryService>;
}) {
  const existingQueue = await input.boss.getQueue(SYNC_CONTENT_QUEUE_NAME);

  if (!existingQueue) {
    await input.boss.createQueue(SYNC_CONTENT_QUEUE_NAME, {
      retryLimit: 0,
      expireInSeconds: COMBINED_PDF_EXPIRE_SECONDS,
      retentionSeconds: COMBINED_PDF_DELETE_AFTER_SECONDS
    });
  }

  await input.boss.work(
    SYNC_CONTENT_QUEUE_NAME,
    {
      batchSize: 1,
      pollingIntervalSeconds: 1
    },
    async ([job]: Array<{ id: string; data: CombinedPdfJobPayload }>) => {
      if (!job) {
        return;
      }

      const payload = readJobPayload(job as CombinedPdfBossJob);
      const jobId = String(job.id);
      const startedAtMs = Date.now();

      if (!payload) {
        throw new Error("sync-content-shops job payload is invalid");
      }

      const { tenantId, chatId, languageCode } = payload;

      try {
        const result = await createSyncContentShopsServiceWithProgressLogging({
          db: input.db,
          logger: input.logger,
          tenantId,
          jobId
        }).syncContentShops();

        input.logger.info(
          {
            tenantId,
            jobId,
            processedShops: result.processedShops,
            successCount: result.successCount,
            failureCount: result.failureCount,
            totalCardsUpserted: result.totalCardsUpserted,
            durationMs: Date.now() - startedAtMs
          },
          "sync-content-shops flow completed"
        );

        await input.telegramDelivery.sendSyncContentShopsCompleted(chatId, result, languageCode);

        return {
          summary: {
            processedShops: result.processedShops,
            successCount: result.successCount,
            failureCount: result.failureCount,
            totalCardsUpserted: result.totalCardsUpserted
          }
        };
      } catch (error) {
        await input.telegramDelivery
          .sendSyncContentShopsFailed(chatId, toErrorMessage(error), languageCode)
          .catch((notificationError) => {
            input.logger.error(
              {
                tenantId,
                jobId,
                error: toErrorMessage(notificationError)
              },
              "failed to notify telegram chat about sync-content-shops failure"
            );
          });

        input.logger.error(
          {
            tenantId,
            jobId,
            error: toErrorMessage(error),
            durationMs: Date.now() - startedAtMs
          },
          "sync-content-shops flow failed"
        );

        throw error;
      }
    }
  );

  input.logger.info(
    {
      queueName: SYNC_CONTENT_QUEUE_NAME
    },
    "pg-boss worker initialized"
  );
}

function createSyncContentShopsServiceWithProgressLogging(input: {
  db: ReturnType<typeof getDatabase>;
  logger: ReturnType<typeof createLogger>;
  tenantId: string;
  jobId?: string;
}) {
  return createSyncContentShopsService({
    db: input.db,
    tenantId: input.tenantId,
    onWbCardsListResponse(event) {
      input.logger.info(
        {
          tenantId: input.tenantId,
          jobId: input.jobId,
          shopId: event.shopId,
          shopName: event.shopName,
          page: event.page,
          apiBaseUrl: event.apiBaseUrl,
          responseStatus: event.responseStatus,
          responseUrl: event.responseUrl,
          requestLimit: event.requestBody.settings?.cursor?.limit ?? null,
          requestCursorUpdatedAt: event.requestBody.settings?.cursor?.updatedAt ?? null,
          requestCursorNmId: event.requestBody.settings?.cursor?.nmID ?? null,
          cardsCount: event.responseData.cards?.length ?? 0,
          responseCursorUpdatedAt: event.responseData.cursor?.updatedAt ?? null,
          responseCursorNmId: event.responseData.cursor?.nmID ?? null,
          responseCursorTotal: event.responseData.cursor?.total ?? null
        },
        "WB sync-content page fetched"
      );
    }
  });
}

async function registerPdfWorker(input: {
  boss: PgBoss;
  logger: ReturnType<typeof createLogger>;
  queueName: string;
  flowLabel: "combined-pdf" | "waiting-orders-pdf";
  createResult: (payload: { tenantId: string; jobId: string }) => Promise<GetCombinedPdfListsResult>;
  notifySuccess: (chatId: number, result: GetCombinedPdfListsResult, languageCode: string | null) => Promise<void>;
  notifyFailure: (chatId: number, errorMessage: string, languageCode: string | null) => Promise<void>;
}) {
  const existingQueue = await input.boss.getQueue(input.queueName);

  if (!existingQueue) {
    await input.boss.createQueue(input.queueName, {
      retryLimit: 0,
      expireInSeconds: COMBINED_PDF_EXPIRE_SECONDS,
      retentionSeconds: COMBINED_PDF_DELETE_AFTER_SECONDS
    });
  }

  await input.boss.work(
    input.queueName,
    {
      batchSize: 1,
      pollingIntervalSeconds: 1
    },
    async ([job]: Array<{ id: string; data: CombinedPdfJobPayload }>) => {
      if (!job) {
        return;
      }

      const payload = readJobPayload(job as CombinedPdfBossJob);
      const jobId = String(job.id);
      const startedAtMs = Date.now();

      if (!payload) {
        throw new Error(`${input.flowLabel} job payload is invalid`);
      }

      const { tenantId, chatId, languageCode } = payload;

      try {
        const result = await input.createResult({ tenantId, jobId });

        input.logger.info(
          {
            tenantId,
            jobId,
            processedShops: result.processedShops,
            successCount: result.successCount,
            skippedCount: result.skippedCount,
            failureCount: result.failureCount,
            totalOrdersCollected: result.totalOrdersCollected,
            durationMs: Date.now() - startedAtMs
          },
          `${input.flowLabel} flow completed`
        );

        await input.notifySuccess(chatId, result, languageCode);

        return {
          summary: {
            processedShops: result.processedShops,
            successCount: result.successCount,
            skippedCount: result.skippedCount,
            failureCount: result.failureCount,
            totalOrdersCollected: result.totalOrdersCollected
          }
        };
      } catch (error) {
        await input
          .notifyFailure(chatId, toErrorMessage(error), languageCode)
          .catch((notificationError) => {
            input.logger.error(
              {
                tenantId,
                jobId,
                error: toErrorMessage(notificationError)
              },
              `failed to notify telegram chat about ${input.flowLabel} failure`
            );
          });

        input.logger.error(
          {
            tenantId,
            jobId,
            error: toErrorMessage(error),
            durationMs: Date.now() - startedAtMs
          },
          `${input.flowLabel} flow failed`
        );

        throw error;
      }
    }
  );

  input.logger.info(
    {
      queueName: input.queueName
    },
    "pg-boss worker initialized"
  );
}

function mapBossJobToSnapshot(job: CombinedPdfBossJob): CombinedPdfJobSnapshot {
  const status = mapBossStateToSnapshotStatus(job.state);
  const output = job.output;

  return {
    jobId: job.id,
    status,
    createdAt: parseDateOrNow(job.createdOn),
    startedAt: parseDateOrNull(job.startedOn),
    finishedAt: parseDateOrNull(job.completedOn),
    error: status === "failed" ? readJobError(output) : null,
    result: status === "completed" ? readCompletedResult(output) : null
  };
}

function mapBossStateToSnapshotStatus(state: BossJobState | undefined): CombinedPdfJobStatus {
  if (state === "active") {
    return "running";
  }

  if (state === "completed") {
    return "completed";
  }

  if (state === "failed" || state === "cancelled") {
    return "failed";
  }

  return "queued";
}

function readTenantIdFromJob(job: CombinedPdfBossJob): string | null {
  const payload = readJobPayload(job);
  return payload?.tenantId ?? null;
}

function readJobPayload(job: CombinedPdfBossJob): CombinedPdfJobPayload | null {
  if (!job.data || typeof job.data !== "object") {
    return null;
  }

  const tenantId = (job.data as { tenantId?: unknown }).tenantId;
  const chatId = (job.data as { chatId?: unknown }).chatId;
  const languageCodeRaw = (job.data as { languageCode?: unknown }).languageCode;

  if (typeof tenantId !== "string") {
    return null;
  }

  if (typeof chatId !== "number" || !Number.isSafeInteger(chatId)) {
    return null;
  }

  const languageCode =
    typeof languageCodeRaw === "string" && languageCodeRaw.trim().length > 0
      ? languageCodeRaw.trim()
      : null;

  return {
    tenantId,
    chatId,
    languageCode
  };
}

function readCompletedResult(output: unknown): GetCombinedPdfListsResult | null {
  if (!output || typeof output !== "object") {
    return null;
  }

  const wrapped = output as { result?: unknown };

  if (isCombinedPdfListsResult(wrapped.result)) {
    return wrapped.result as GetCombinedPdfListsResult;
  }

  if (isCombinedPdfListsResult(output)) {
    return output;
  }

  return null;
}

function readJobError(output: unknown): string {
  if (!output) {
    return "Combined PDF job failed";
  }

  if (typeof output === "string") {
    return output;
  }

  if (typeof output === "object") {
    const payload = output as {
      message?: unknown;
      error?: unknown;
      value?: unknown;
      stack?: unknown;
    };

    if (typeof payload.message === "string" && payload.message.length > 0) {
      return payload.message;
    }

    if (typeof payload.error === "string" && payload.error.length > 0) {
      return payload.error;
    }

    if (typeof payload.value === "string" && payload.value.length > 0) {
      return payload.value;
    }

    if (typeof payload.stack === "string" && payload.stack.length > 0) {
      return payload.stack;
    }
  }

  return "Combined PDF job failed";
}

function parseDateOrNow(value: Date | string | undefined): Date {
  const parsed = parseDateOrNull(value);
  return parsed ?? new Date();
}

function parseDateOrNull(value: Date | string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function resolveBossSchema(): string {
  const schema = readRuntimeEnv("PG_BOSS_SCHEMA") ?? DEFAULT_PG_BOSS_SCHEMA;

  return /^[a-z_][a-z0-9_]*$/u.test(schema) ? schema : DEFAULT_PG_BOSS_SCHEMA;
}

async function findActivePdfJobForTenant(input: {
  boss: PgBoss;
  schema: string;
  queueName: string;
  tenantId: string;
}): Promise<{ id: string; state: BossJobState; createdOn: Date | string | undefined } | null> {
  const query = `
    SELECT id, state, created_on AS "createdOn"
    FROM ${input.schema}.job
    WHERE name = $1
      AND state IN ('created', 'retry', 'active')
      AND data->>'tenantId' = $2
    ORDER BY created_on DESC
    LIMIT 1
  `;

  const result = await input.boss.getDb().executeSql(query, [input.queueName, input.tenantId]);
  const row = (result.rows as Array<{ id?: unknown; state?: unknown; createdOn?: unknown }>)[0];

  if (!row || typeof row.id !== "string") {
    return null;
  }

  const state = row.state;

  if (
    state !== "created" &&
    state !== "retry" &&
    state !== "active" &&
    state !== "completed" &&
    state !== "cancelled" &&
    state !== "failed"
  ) {
    return null;
  }

  return {
    id: row.id,
    state,
    createdOn: row.createdOn as Date | string | undefined
  };
}

function isCombinedPdfListsResult(value: unknown): value is GetCombinedPdfListsResult {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as {
    orderListPdfBase64?: unknown;
    stickersPdfBase64?: unknown;
    orderListFileName?: unknown;
    stickersFileName?: unknown;
  };

  return (
    typeof candidate.orderListPdfBase64 === "string" &&
    typeof candidate.stickersPdfBase64 === "string" &&
    typeof candidate.orderListFileName === "string" &&
    typeof candidate.stickersFileName === "string"
  );
}
