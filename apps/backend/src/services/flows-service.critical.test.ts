import { beforeEach, describe, expect, it, vi } from "vitest";

type BossJobState = "created" | "retry" | "active" | "completed" | "cancelled" | "failed";

const testState = vi.hoisted(() => ({
  runtimeEnv: {} as Record<string, string | undefined>,
  activeJobs: [] as Array<{
    queueName: string;
    tenantId: string;
    id: string;
    state: string;
    createdOn?: Date | string;
  }>,
  jobsById: new Map<string, unknown>(),
  sendNullQueues: new Set<string>(),
  lastExecuteSqlQuery: "" as string,
  bossInstances: [] as Array<{
    startCalls: number;
    sendCalls: Array<{ queueName: string; data: unknown; options: unknown }>;
    workers: Array<{
      queueName: string;
      handler: (jobs: Array<{ id: string; data: unknown }>) => Promise<unknown>;
    }>;
    queueNames: Set<string>;
  }>,
  coreCombinedResult: {} as Record<string, unknown>,
  coreSyncResult: {} as Record<string, unknown>,
  coreProcessResult: {} as Record<string, unknown>,
  coreErrors: {
    combined: null as Error | null,
    waiting: null as Error | null,
    sync: null as Error | null,
    process: null as Error | null
  },
  telegram: {
    sendCombinedPdfGenerated: vi.fn(async () => undefined),
    sendCombinedPdfFailed: vi.fn(async () => undefined),
    sendWaitingOrdersPdfGenerated: vi.fn(async () => undefined),
    sendWaitingOrdersPdfFailed: vi.fn(async () => undefined),
    sendSyncContentShopsCompleted: vi.fn(async () => undefined),
    sendSyncContentShopsFailed: vi.fn(async () => undefined)
  },
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn()
}));

function createBaseCombinedResult() {
  return {
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
    finishedAt: new Date("2026-01-01T00:00:01.000Z"),
    processedShops: 3,
    successCount: 2,
    skippedCount: 0,
    failureCount: 1,
    totalOrdersCollected: 12,
    orderListFileName: "order-list.pdf",
    stickersFileName: "stickers.pdf",
    orderListPdfBase64: "base64-order-list",
    stickersPdfBase64: "base64-stickers",
    results: []
  };
}

function createBaseSyncResult() {
  return {
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
    finishedAt: new Date("2026-01-01T00:00:01.000Z"),
    processedShops: 2,
    successCount: 2,
    failureCount: 0,
    totalCardsUpserted: 23,
    results: []
  };
}

function createBaseProcessResult() {
  return {
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
    finishedAt: new Date("2026-01-01T00:00:01.000Z"),
    processedShops: 1,
    successCount: 1,
    skippedCount: 0,
    failureCount: 0,
    results: []
  };
}

vi.mock("pg-boss", async () => {
  class FakePgBoss {
    readonly queueNames = new Set<string>();
    readonly sendCalls: Array<{ queueName: string; data: unknown; options: unknown }> = [];
    readonly workers: Array<{
      queueName: string;
      handler: (jobs: Array<{ id: string; data: unknown }>) => Promise<unknown>;
    }> = [];
    startCalls = 0;

    constructor(_options: unknown) {
      testState.bossInstances.push(this);
    }

    async start(): Promise<void> {
      this.startCalls += 1;
    }

    async getQueue(queueName: string): Promise<{ name: string } | null> {
      return this.queueNames.has(queueName) ? { name: queueName } : null;
    }

    async createQueue(queueName: string): Promise<void> {
      this.queueNames.add(queueName);
    }

    async work(
      queueName: string,
      _options: unknown,
      handler: (jobs: Array<{ id: string; data: unknown }>) => Promise<unknown>
    ): Promise<void> {
      this.workers.push({ queueName, handler });
    }

    async send(queueName: string, data: unknown, options: { id: string }): Promise<string | null> {
      this.sendCalls.push({ queueName, data, options });

      if (testState.sendNullQueues.has(queueName)) {
        return null;
      }

      return options.id;
    }

    async getJobById(_queueName: string, jobId: string): Promise<unknown> {
      return testState.jobsById.get(jobId) ?? null;
    }

    getDb() {
      return {
        executeSql: async (query: string, params: unknown[]) => {
          testState.lastExecuteSqlQuery = query;
          const [queueName, tenantId] = params as [string, string];

          const rows = testState.activeJobs
            .filter((item) => item.queueName === queueName && item.tenantId === tenantId)
            .map((item) => ({
              id: item.id,
              state: item.state,
              createdOn: item.createdOn
            }));

          return { rows };
        }
      };
    }
  }

  return { PgBoss: FakePgBoss };
});

vi.mock("@wb-automation-v2/core", async () => {
  return {
    createGetCombinedPdfListsService: (options: { onWbApiDebug?: (event: unknown) => void }) => ({
      async getCombinedPdfLists() {
        options.onWbApiDebug?.({ step: "combined-debug" });

        if (testState.coreErrors.combined) {
          throw testState.coreErrors.combined;
        }

        return testState.coreCombinedResult;
      }
    }),
    createGetWaitingOrdersPdfListsService: (options: {
      onWbApiDebug?: (event: unknown) => void;
    }) => ({
      async getWaitingOrdersPdfLists() {
        options.onWbApiDebug?.({ step: "waiting-debug" });

        if (testState.coreErrors.waiting) {
          throw testState.coreErrors.waiting;
        }

        return testState.coreCombinedResult;
      }
    }),
    createProcessAllShopsService: (options: { onWbApiDebug?: (event: unknown) => void }) => ({
      async processAllShops() {
        options.onWbApiDebug?.({ step: "process-debug" });

        if (testState.coreErrors.process) {
          throw testState.coreErrors.process;
        }

        return testState.coreProcessResult;
      }
    }),
    createSyncContentShopsService: (options: {
      onWbCardsListResponse?: (event: unknown) => void;
    }) => ({
      async syncContentShops() {
        options.onWbCardsListResponse?.({
          shopId: "shop-1",
          shopName: "Shop One",
          page: 1,
          apiBaseUrl: "https://api.example",
          responseStatus: 200,
          responseUrl: "https://api.example/cards",
          requestBody: {
            settings: {
              cursor: {
                limit: 100,
                updatedAt: "2026-01-01T00:00:00.000Z",
                nmID: 1
              }
            }
          },
          responseData: {
            cards: [],
            cursor: {
              updatedAt: "2026-01-01T00:00:00.000Z",
              nmID: 1,
              total: 0
            }
          }
        });

        if (testState.coreErrors.sync) {
          throw testState.coreErrors.sync;
        }

        return testState.coreSyncResult;
      }
    }),
    toErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error))
  };
});

vi.mock("@wb-automation-v2/db", async () => {
  return {
    getDatabase: () => ({}),
    getDatabaseUrl: () => "postgresql://test"
  };
});

vi.mock("../config/env.js", async () => {
  return {
    readRuntimeEnv: (key: string) => testState.runtimeEnv[key]
  };
});

vi.mock("../logger.js", async () => {
  return {
    createLogger: () => ({
      info: testState.loggerInfo,
      error: testState.loggerError,
      warn: testState.loggerWarn
    })
  };
});

vi.mock("./telegram-delivery-service.js", async () => {
  return {
    createTelegramDeliveryService: () => ({
      sendCombinedPdfGenerated: testState.telegram.sendCombinedPdfGenerated,
      sendCombinedPdfFailed: testState.telegram.sendCombinedPdfFailed,
      sendWaitingOrdersPdfGenerated: testState.telegram.sendWaitingOrdersPdfGenerated,
      sendWaitingOrdersPdfFailed: testState.telegram.sendWaitingOrdersPdfFailed,
      sendSyncContentShopsCompleted: testState.telegram.sendSyncContentShopsCompleted,
      sendSyncContentShopsFailed: testState.telegram.sendSyncContentShopsFailed,
      async sendSyncContentShopsFailureSummary() {},
      async sendWbTokenExpirationWarnings() {}
    })
  };
});

import { createBackendFlowsService, FlowJobNotFoundError } from "./flows-service.js";

describe("flows-service critical behavior", () => {
  beforeEach(() => {
    testState.runtimeEnv = {};
    testState.activeJobs = [];
    testState.jobsById.clear();
    testState.sendNullQueues.clear();
    testState.lastExecuteSqlQuery = "";
    testState.bossInstances.length = 0;
    testState.coreCombinedResult = createBaseCombinedResult();
    testState.coreSyncResult = createBaseSyncResult();
    testState.coreProcessResult = createBaseProcessResult();
    testState.coreErrors.combined = null;
    testState.coreErrors.waiting = null;
    testState.coreErrors.sync = null;
    testState.coreErrors.process = null;
    testState.telegram.sendCombinedPdfGenerated.mockReset().mockResolvedValue(undefined);
    testState.telegram.sendCombinedPdfFailed.mockReset().mockResolvedValue(undefined);
    testState.telegram.sendWaitingOrdersPdfGenerated.mockReset().mockResolvedValue(undefined);
    testState.telegram.sendWaitingOrdersPdfFailed.mockReset().mockResolvedValue(undefined);
    testState.telegram.sendSyncContentShopsCompleted.mockReset().mockResolvedValue(undefined);
    testState.telegram.sendSyncContentShopsFailed.mockReset().mockResolvedValue(undefined);
    testState.loggerInfo.mockReset();
    testState.loggerError.mockReset();
    testState.loggerWarn.mockReset();
  });

  it("covers queue start paths for waiting-orders and sync-content", async () => {
    testState.activeJobs.push({
      queueName: "flows.get-waiting-orders-pdf",
      tenantId: "tenant-1",
      id: "job-existing",
      state: "created",
      createdOn: "2026-02-20T10:00:00.000Z"
    });

    const service = createBackendFlowsService();
    const waitingExisting = await service.startWaitingOrdersPdfJob("tenant-1", 10, "en");
    expect(waitingExisting).toMatchObject({ jobId: "job-existing", status: "queued" });

    const syncQueued = await service.startSyncContentShopsJob("tenant-2", 20, "ru");
    expect(syncQueued.status).toBe("queued");

    const boss = testState.bossInstances[0];
    expect(boss?.sendCalls.some((call) => call.queueName === "flows.sync-content-shops")).toBe(
      true
    );

    testState.sendNullQueues.add("flows.sync-content-shops");
    await expect(service.startSyncContentShopsJob("tenant-3", 30, "ru")).rejects.toThrow(
      "Unable to enqueue sync-content-shops flow job"
    );
  });

  it("processes sync and process flows through core services", async () => {
    const service = createBackendFlowsService();

    const processResult = await service.processAllShops("tenant-p");
    const syncResult = await service.syncContentShops("tenant-s");

    expect(processResult.successCount).toBe(1);
    expect(syncResult.totalCardsUpserted).toBe(23);
    expect(testState.loggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-p", successCount: 1 }),
      "process-all-shops flow completed"
    );
  });

  it("maps completed and failed job snapshots for different output shapes", async () => {
    const service = createBackendFlowsService();

    testState.jobsById.set("job-completed-wrapped", {
      id: "job-completed-wrapped",
      state: "completed",
      createdOn: "2026-02-20T10:00:00.000Z",
      data: { tenantId: "tenant-a", chatId: 1, languageCode: null },
      output: {
        result: {
          ...createBaseCombinedResult()
        }
      }
    });

    const wrapped = await service.getCombinedPdfListsJob("tenant-a", "job-completed-wrapped");
    expect(wrapped.status).toBe("completed");
    expect(wrapped.result?.orderListFileName).toBe("order-list.pdf");

    testState.jobsById.set("job-completed-direct", {
      id: "job-completed-direct",
      state: "completed",
      createdOn: "2026-02-20T10:00:00.000Z",
      data: { tenantId: "tenant-a", chatId: 1, languageCode: null },
      output: {
        ...createBaseCombinedResult()
      }
    });

    const direct = await service.getCombinedPdfListsJob("tenant-a", "job-completed-direct");
    expect(direct.status).toBe("completed");
    expect(direct.result?.stickersFileName).toBe("stickers.pdf");

    testState.jobsById.set("job-failed-error", {
      id: "job-failed-error",
      state: "failed",
      createdOn: "2026-02-20T10:00:00.000Z",
      data: { tenantId: "tenant-a", chatId: 1, languageCode: null },
      output: { error: "failed by error field" }
    });

    const failedByErrorField = await service.getCombinedPdfListsJob("tenant-a", "job-failed-error");
    expect(failedByErrorField.error).toBe("failed by error field");

    testState.jobsById.set("job-failed-none", {
      id: "job-failed-none",
      state: "failed",
      createdOn: "2026-02-20T10:00:00.000Z",
      data: { tenantId: "tenant-a", chatId: 1, languageCode: null },
      output: null
    });

    const failedNoPayload = await service.getCombinedPdfListsJob("tenant-a", "job-failed-none");
    expect(failedNoPayload.error).toBe("Combined PDF job failed");
  });

  it("treats malformed payloads as missing jobs (tenant protection)", async () => {
    const service = createBackendFlowsService();

    const badJobs = [
      {
        id: "job-no-data",
        state: "completed",
        data: null
      },
      {
        id: "job-no-tenant",
        state: "completed",
        data: { chatId: 1, languageCode: null }
      },
      {
        id: "job-invalid-chat",
        state: "completed",
        data: { tenantId: "tenant-a", chatId: 1.2, languageCode: null }
      }
    ];

    for (const job of badJobs) {
      testState.jobsById.set(job.id, job);

      await expect(service.getCombinedPdfListsJob("tenant-a", job.id)).rejects.toBeInstanceOf(
        FlowJobNotFoundError
      );
    }
  });

  it("validates PG_BOSS_SCHEMA and ignores unknown active-job states", async () => {
    testState.runtimeEnv.PG_BOSS_SCHEMA = "bad-schema!";
    testState.activeJobs.push({
      queueName: "flows.get-combined-pdf-lists",
      tenantId: "tenant-z",
      id: "job-weird",
      state: "mystery"
    });

    const serviceWithBadSchema = createBackendFlowsService();
    await serviceWithBadSchema.startCombinedPdfListsJob("tenant-z", 10, "en");

    expect(testState.lastExecuteSqlQuery).toContain("FROM pgboss.job");

    testState.runtimeEnv.PG_BOSS_SCHEMA = "custom_schema";
    const serviceWithCustomSchema = createBackendFlowsService();
    await serviceWithCustomSchema.startCombinedPdfListsJob("tenant-q", 11, "en");
    expect(testState.lastExecuteSqlQuery).toContain("FROM custom_schema.job");
  });

  it("executes combined-pdf worker success and failure paths", async () => {
    const service = createBackendFlowsService();
    await service.startCombinedPdfListsJob("tenant-a", 1, "en");

    const boss = testState.bossInstances[0];
    const combinedWorker = boss?.workers.find(
      (worker) => worker.queueName === "flows.get-combined-pdf-lists"
    );

    if (!combinedWorker) {
      throw new Error("combined worker not registered");
    }

    const summary = await combinedWorker.handler([
      {
        id: "job-1",
        data: { tenantId: "tenant-a", chatId: 77, languageCode: "en" }
      }
    ]);

    expect(summary).toEqual({
      summary: {
        processedShops: 3,
        successCount: 2,
        skippedCount: 0,
        failureCount: 1,
        totalOrdersCollected: 12
      }
    });
    expect(testState.telegram.sendCombinedPdfGenerated).toHaveBeenCalledWith(
      77,
      testState.coreCombinedResult,
      "en"
    );

    testState.coreErrors.combined = new Error("combined failed");
    await expect(
      combinedWorker.handler([
        {
          id: "job-2",
          data: { tenantId: "tenant-a", chatId: 88, languageCode: "ru" }
        }
      ])
    ).rejects.toThrow("combined failed");
    expect(testState.telegram.sendCombinedPdfFailed).toHaveBeenCalledWith(
      88,
      "combined failed",
      "ru"
    );

    testState.telegram.sendCombinedPdfFailed.mockRejectedValueOnce(new Error("notify failed"));
    await expect(
      combinedWorker.handler([
        {
          id: "job-3",
          data: { tenantId: "tenant-a", chatId: 99, languageCode: "ru" }
        }
      ])
    ).rejects.toThrow("combined failed");
    expect(testState.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-a",
        jobId: "job-3",
        error: "notify failed"
      }),
      "failed to notify telegram chat about combined-pdf failure"
    );
  });

  it("executes sync-content worker success, invalid payload and failure paths", async () => {
    const service = createBackendFlowsService();
    await service.startCombinedPdfListsJob("tenant-a", 1, "en");

    const boss = testState.bossInstances[0];
    const syncWorker = boss?.workers.find(
      (worker) => worker.queueName === "flows.sync-content-shops"
    );

    if (!syncWorker) {
      throw new Error("sync worker not registered");
    }

    const success = await syncWorker.handler([
      {
        id: "sync-1",
        data: { tenantId: "tenant-a", chatId: 100, languageCode: "en" }
      }
    ]);
    expect(success).toEqual({
      summary: {
        processedShops: 2,
        successCount: 2,
        failureCount: 0,
        totalCardsUpserted: 23
      }
    });
    expect(testState.telegram.sendSyncContentShopsCompleted).toHaveBeenCalledWith(
      100,
      testState.coreSyncResult,
      "en"
    );

    await expect(
      syncWorker.handler([{ id: "sync-invalid", data: { tenantId: "tenant-a", chatId: "oops" } }])
    ).rejects.toThrow("sync-content-shops job payload is invalid");

    testState.coreErrors.sync = new Error("sync exploded");
    await expect(
      syncWorker.handler([
        {
          id: "sync-2",
          data: { tenantId: "tenant-a", chatId: 101, languageCode: "ru" }
        }
      ])
    ).rejects.toThrow("sync exploded");
    expect(testState.telegram.sendSyncContentShopsFailed).toHaveBeenCalledWith(
      101,
      "sync exploded",
      "ru"
    );
  });

  it("returns immediately when worker receives empty batches", async () => {
    const service = createBackendFlowsService();
    await service.startCombinedPdfListsJob("tenant-a", 1, "en");

    const boss = testState.bossInstances[0];
    const combinedWorker = boss?.workers.find(
      (worker) => worker.queueName === "flows.get-combined-pdf-lists"
    );
    const syncWorker = boss?.workers.find(
      (worker) => worker.queueName === "flows.sync-content-shops"
    );

    if (!combinedWorker || !syncWorker) {
      throw new Error("workers are not registered");
    }

    await expect(combinedWorker.handler([])).resolves.toBeUndefined();
    await expect(syncWorker.handler([])).resolves.toBeUndefined();
  });

  it("maps cancelled and unknown states to snapshot statuses", async () => {
    const service = createBackendFlowsService();

    testState.jobsById.set("job-cancelled", {
      id: "job-cancelled",
      state: "cancelled" satisfies BossJobState,
      data: { tenantId: "tenant-a", chatId: 1, languageCode: null }
    });
    testState.jobsById.set("job-created", {
      id: "job-created",
      state: "created" satisfies BossJobState,
      data: { tenantId: "tenant-a", chatId: 1, languageCode: null }
    });

    const cancelled = await service.getCombinedPdfListsJob("tenant-a", "job-cancelled");
    const created = await service.getCombinedPdfListsJob("tenant-a", "job-created");

    expect(cancelled.status).toBe("failed");
    expect(created.status).toBe("queued");
  });
});
