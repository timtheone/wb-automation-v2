import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  runtimeEnv: {} as Record<string, string | undefined>,
  activeJobs: [] as Array<{
    queueName: string;
    tenantId: string;
    id: string;
    state: "created" | "retry" | "active" | "completed" | "cancelled" | "failed";
    createdOn?: Date | string;
  }>,
  jobsById: new Map<string, unknown>(),
  bossInstances: [] as Array<{
    startCalls: number;
    sendCalls: Array<{ queueName: string; data: unknown; options: unknown }>;
    getJobByIdCalls: Array<{ queueName: string; jobId: string }>;
    queueNames: Set<string>;
    workers: Array<{ queueName: string; handler: unknown }>;
  }>
}));

vi.mock("pg-boss", async () => {
  class FakePgBoss {
    readonly queueNames = new Set<string>();
    readonly workers: Array<{ queueName: string; handler: unknown }> = [];
    readonly sendCalls: Array<{ queueName: string; data: unknown; options: unknown }> = [];
    readonly getJobByIdCalls: Array<{ queueName: string; jobId: string }> = [];
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

    async work(queueName: string, _options: unknown, handler: unknown): Promise<void> {
      this.workers.push({ queueName, handler });
    }

    async send(queueName: string, data: unknown, options: { id: string }): Promise<string> {
      this.sendCalls.push({ queueName, data, options });
      return options.id;
    }

    async getJobById(queueName: string, jobId: string): Promise<unknown> {
      this.getJobByIdCalls.push({ queueName, jobId });
      return testState.jobsById.get(jobId) ?? null;
    }

    getDb() {
      return {
        executeSql: async (_query: string, params: unknown[]) => {
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
  const fakeCombinedResult = {
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
    finishedAt: new Date("2026-01-01T00:00:01.000Z"),
    processedShops: 0,
    successCount: 0,
    skippedCount: 0,
    failureCount: 0,
    totalOrdersCollected: 0,
    orderListFileName: "order-list.pdf",
    stickersFileName: "stickers.pdf",
    orderListPdfBase64: "",
    stickersPdfBase64: "",
    results: []
  };

  return {
    createGetCombinedPdfListsService: () => ({
      async getCombinedPdfLists() {
        return fakeCombinedResult;
      }
    }),
    createGetWaitingOrdersPdfListsService: () => ({
      async getWaitingOrdersPdfLists() {
        return fakeCombinedResult;
      }
    }),
    createProcessAllShopsService: () => ({
      async processAllShops() {
        return {
          startedAt: new Date("2026-01-01T00:00:00.000Z"),
          finishedAt: new Date("2026-01-01T00:00:01.000Z"),
          processedShops: 0,
          successCount: 0,
          skippedCount: 0,
          failureCount: 0,
          results: []
        };
      }
    }),
    createSyncContentShopsService: () => ({
      async syncContentShops() {
        return {
          startedAt: new Date("2026-01-01T00:00:00.000Z"),
          finishedAt: new Date("2026-01-01T00:00:01.000Z"),
          processedShops: 0,
          successCount: 0,
          failureCount: 0,
          totalCardsUpserted: 0,
          results: []
        };
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
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  };
});

vi.mock("./telegram-delivery-service.js", async () => {
  return {
    createTelegramDeliveryService: () => ({
      async sendCombinedPdfGenerated() {},
      async sendCombinedPdfFailed() {},
      async sendWaitingOrdersPdfGenerated() {},
      async sendWaitingOrdersPdfFailed() {},
      async sendSyncContentShopsCompleted() {},
      async sendSyncContentShopsFailed() {},
      async sendSyncContentShopsFailureSummary() {},
      async sendWbTokenExpirationWarnings() {}
    })
  };
});

import { createBackendFlowsService, FlowJobNotFoundError } from "./flows-service.js";

describe("backend flows service queue orchestration", () => {
  beforeEach(() => {
    testState.runtimeEnv = {};
    testState.activeJobs = [];
    testState.jobsById.clear();
    testState.bossInstances.length = 0;
  });

  it("reuses an active combined-pdf job for the same tenant", async () => {
    testState.activeJobs.push({
      queueName: "flows.get-combined-pdf-lists",
      tenantId: "tenant-1",
      id: "job-existing",
      state: "active",
      createdOn: "2026-02-19T10:00:00.000Z"
    });

    const service = createBackendFlowsService();
    const accepted = await service.startCombinedPdfListsJob("tenant-1", 777, "en");

    expect(accepted).toMatchObject({
      jobId: "job-existing",
      status: "running"
    });
    expect(accepted.createdAt.toISOString()).toBe("2026-02-19T10:00:00.000Z");

    const boss = testState.bossInstances[0];
    expect(boss?.sendCalls).toHaveLength(0);
    expect(boss?.startCalls).toBe(1);
  });

  it("enqueues a new combined-pdf job when no active tenant job exists", async () => {
    const service = createBackendFlowsService();
    const accepted = await service.startCombinedPdfListsJob("tenant-2", 555, "ru");

    expect(accepted.status).toBe("queued");
    expect(accepted.jobId).toHaveLength(36);

    const boss = testState.bossInstances[0];
    expect(boss?.sendCalls).toHaveLength(1);

    const call = boss?.sendCalls[0];
    expect(call).toMatchObject({
      queueName: "flows.get-combined-pdf-lists",
      data: {
        tenantId: "tenant-2",
        chatId: 555,
        languageCode: "ru"
      }
    });
    expect(call?.options).toMatchObject({
      retryLimit: 0,
      expireInSeconds: 3600,
      retentionSeconds: 1800
    });
  });

  it("denies cross-tenant access to combined-pdf job status", async () => {
    testState.jobsById.set("job-1", {
      id: "job-1",
      state: "completed",
      data: {
        tenantId: "tenant-foreign",
        chatId: 100,
        languageCode: "en"
      }
    });

    const service = createBackendFlowsService();

    await expect(service.getCombinedPdfListsJob("tenant-allowed", "job-1")).rejects.toBeInstanceOf(
      FlowJobNotFoundError
    );
  });

  it("maps failed pg-boss jobs into failed API snapshots", async () => {
    testState.jobsById.set("job-failed", {
      id: "job-failed",
      state: "failed",
      createdOn: "2026-02-19T10:00:00.000Z",
      startedOn: "2026-02-19T10:00:05.000Z",
      completedOn: "2026-02-19T10:00:09.000Z",
      data: {
        tenantId: "tenant-1",
        chatId: 111,
        languageCode: null
      },
      output: {
        message: "worker crashed"
      }
    });

    const service = createBackendFlowsService();
    const snapshot = await service.getCombinedPdfListsJob("tenant-1", "job-failed");

    expect(snapshot).toMatchObject({
      jobId: "job-failed",
      status: "failed",
      error: "worker crashed",
      result: null
    });
    expect(snapshot.startedAt?.toISOString()).toBe("2026-02-19T10:00:05.000Z");
    expect(snapshot.finishedAt?.toISOString()).toBe("2026-02-19T10:00:09.000Z");
  });
});
