import { PgBoss } from "pg-boss";
import {
  createGetCombinedPdfListsService,
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
      return createSyncContentShopsService({ db, tenantId }).syncContentShops();
    },
    async startCombinedPdfListsJob(tenantId, chatId, languageCode) {
      await ensureQueueWorker();

      const existingJob = await findActiveCombinedPdfJobForTenant({
        boss,
        schema: bossSchema,
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

  const existingQueue = await input.boss.getQueue(COMBINED_PDF_QUEUE_NAME);

  if (!existingQueue) {
    await input.boss.createQueue(COMBINED_PDF_QUEUE_NAME, {
      retryLimit: 0,
      expireInSeconds: COMBINED_PDF_EXPIRE_SECONDS,
      retentionSeconds: COMBINED_PDF_DELETE_AFTER_SECONDS
    });
  }

  await input.boss.work(
    COMBINED_PDF_QUEUE_NAME,
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
        throw new Error("Combined PDF job payload is invalid");
      }

      const { tenantId, chatId, languageCode } = payload;

      try {
        const result = await createGetCombinedPdfListsService({
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
        }).getCombinedPdfLists();

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
          "combined-pdf flow completed"
        );

        await input.telegramDelivery.sendCombinedPdfGenerated(chatId, result, languageCode);

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
        await input.telegramDelivery
          .sendCombinedPdfFailed(chatId, toErrorMessage(error), languageCode)
          .catch((notificationError) => {
            input.logger.error(
              {
                tenantId,
                jobId,
                error: toErrorMessage(notificationError)
              },
              "failed to notify telegram chat about combined-pdf failure"
            );
          });

        input.logger.error(
          {
            tenantId,
            jobId,
            error: toErrorMessage(error),
            durationMs: Date.now() - startedAtMs
          },
          "combined-pdf flow failed"
        );

        throw error;
      }
    }
  );

  input.logger.info(
    {
      queueName: COMBINED_PDF_QUEUE_NAME
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

async function findActiveCombinedPdfJobForTenant(input: {
  boss: PgBoss;
  schema: string;
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

  const result = await input.boss.getDb().executeSql(query, [COMBINED_PDF_QUEUE_NAME, input.tenantId]);
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
