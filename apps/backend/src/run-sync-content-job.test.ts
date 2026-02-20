import { beforeEach, describe, expect, it, vi } from "vitest";

type SyncPlan =
  | {
      startedAt: Date;
      finishedAt: Date;
      processedShops: number;
      successCount: number;
      failureCount: number;
      totalCardsUpserted: number;
      results: Array<{
        shopId: string;
        shopName: string;
        status: "success" | "failed";
        pagesFetched: number;
        cardsUpserted: number;
        error: string | null;
      }>;
    }
  | Error;

const testState = vi.hoisted(() => ({
  tenantContexts: [] as Array<{ tenantId: string; ownerTelegramUserId: number }>,
  syncPlans: new Map<string, SyncPlan>(),
  createdSyncServiceTenantIds: [] as string[],
  startCalls: [] as Array<{ tenantId: string; details: unknown }>,
  markSuccessCalls: [] as Array<{ tenantId: string; details: unknown }>,
  markFailedCalls: [] as Array<{ tenantId: string; error: string; details: unknown }>,
  sendFailureSummaryCalls: [] as Array<{ chatId: number; summary: unknown }>,
  sendFailureSummaryError: null as Error | null,
  dbEnd: vi.fn(),
  loggerInfo: vi.fn(),
  loggerError: vi.fn()
}));

vi.mock("@wb-automation-v2/core", async () => {
  return {
    createSyncContentShopsService: ({ tenantId }: { tenantId: string }) => {
      testState.createdSyncServiceTenantIds.push(tenantId);

      return {
        async syncContentShops() {
          const plan = testState.syncPlans.get(tenantId);

          if (!plan) {
            throw new Error(`No sync plan configured for ${tenantId}`);
          }

          if (plan instanceof Error) {
            throw plan;
          }

          return plan;
        }
      };
    },
    toErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error))
  };
});

vi.mock("@wb-automation-v2/db", async () => {
  return {
    createJobRunRepository: ({ tenantId }: { tenantId: string }) => ({
      async start(input: { details: unknown }) {
        testState.startCalls.push({ tenantId, details: input.details });
        return `job-${tenantId}`;
      },
      async markSuccess(input: { details: unknown }) {
        testState.markSuccessCalls.push({ tenantId, details: input.details });
      },
      async markFailed(input: { error: string; details: unknown }) {
        testState.markFailedCalls.push({ tenantId, error: input.error, details: input.details });
      }
    }),
    getDatabaseClient: () => ({
      end: testState.dbEnd
    })
  };
});

vi.mock("./services/tenant-service.js", async () => {
  return {
    createBackendTenantService: () => ({
      async listTenantContexts() {
        return testState.tenantContexts;
      }
    })
  };
});

vi.mock("./services/telegram-delivery-service.js", async () => {
  return {
    createTelegramDeliveryService: () => ({
      async sendSyncContentShopsFailureSummary(chatId: number, summary: unknown) {
        testState.sendFailureSummaryCalls.push({ chatId, summary });

        if (testState.sendFailureSummaryError) {
          throw testState.sendFailureSummaryError;
        }
      }
    })
  };
});

vi.mock("./logger.js", async () => {
  return {
    createLogger: () => ({
      info: testState.loggerInfo,
      error: testState.loggerError
    }),
    getBackendLogFilePath: () => "/tmp/backend.log"
  };
});

describe("run-sync-content-job entrypoint", () => {
  beforeEach(() => {
    testState.tenantContexts = [];
    testState.syncPlans.clear();
    testState.createdSyncServiceTenantIds = [];
    testState.startCalls = [];
    testState.markSuccessCalls = [];
    testState.markFailedCalls = [];
    testState.sendFailureSummaryCalls = [];
    testState.sendFailureSummaryError = null;
    testState.dbEnd.mockReset();
    testState.loggerInfo.mockReset();
    testState.loggerError.mockReset();
  });

  it("exits with code 0 when no tenants are configured", async () => {
    const code = await runEntrypoint();

    expect(code).toBe(0);
    expect(testState.createdSyncServiceTenantIds).toEqual([]);
    expect(testState.dbEnd).toHaveBeenCalled();
  });

  it("sends failure summaries and exits 0 after successful tenant runs", async () => {
    testState.tenantContexts = [{ tenantId: "tenant-1", ownerTelegramUserId: 101 }];
    testState.syncPlans.set("tenant-1", {
      startedAt: new Date("2026-02-20T10:00:00.000Z"),
      finishedAt: new Date("2026-02-20T10:00:10.000Z"),
      processedShops: 2,
      successCount: 1,
      failureCount: 1,
      totalCardsUpserted: 12,
      results: [
        {
          shopId: "shop-ok",
          shopName: "Shop OK",
          status: "success",
          pagesFetched: 1,
          cardsUpserted: 12,
          error: null
        },
        {
          shopId: "shop-fail",
          shopName: "Shop Fail",
          status: "failed",
          pagesFetched: 2,
          cardsUpserted: 0,
          error: "WB timeout"
        }
      ]
    });

    const code = await runEntrypoint();

    expect(code).toBe(0);
    expect(testState.createdSyncServiceTenantIds).toEqual(["tenant-1"]);
    expect(testState.startCalls).toHaveLength(1);
    expect(testState.markSuccessCalls).toHaveLength(1);
    expect(testState.markFailedCalls).toHaveLength(0);

    expect(testState.sendFailureSummaryCalls).toHaveLength(1);
    expect(testState.sendFailureSummaryCalls[0]).toMatchObject({
      chatId: 101,
      summary: {
        processedShops: 2,
        successCount: 1,
        failureCount: 1,
        totalCardsUpserted: 12,
        failedShops: [
          {
            shopId: "shop-fail",
            shopName: "Shop Fail",
            error: "WB timeout"
          }
        ]
      }
    });
    expect(testState.dbEnd).toHaveBeenCalledTimes(1);
  });

  it("exits with code 1 and marks failed run when sync throws", async () => {
    testState.tenantContexts = [{ tenantId: "tenant-2", ownerTelegramUserId: 202 }];
    testState.syncPlans.set("tenant-2", new Error("sync failed hard"));

    const code = await runEntrypoint();

    expect(code).toBe(1);
    expect(testState.markSuccessCalls).toHaveLength(0);
    expect(testState.markFailedCalls).toHaveLength(1);
    expect(testState.markFailedCalls[0]).toMatchObject({
      tenantId: "tenant-2",
      error: "sync failed hard"
    });
    expect(testState.dbEnd).toHaveBeenCalledTimes(1);
  });

  it("keeps exit code 0 when failure-summary notification itself fails", async () => {
    testState.tenantContexts = [{ tenantId: "tenant-3", ownerTelegramUserId: 303 }];
    testState.syncPlans.set("tenant-3", {
      startedAt: new Date("2026-02-20T10:00:00.000Z"),
      finishedAt: new Date("2026-02-20T10:00:05.000Z"),
      processedShops: 1,
      successCount: 0,
      failureCount: 1,
      totalCardsUpserted: 0,
      results: [
        {
          shopId: "shop-err",
          shopName: "Shop Err",
          status: "failed",
          pagesFetched: 1,
          cardsUpserted: 0,
          error: "broken"
        }
      ]
    });
    testState.sendFailureSummaryError = new Error("telegram down");

    const code = await runEntrypoint();

    expect(code).toBe(0);
    expect(testState.sendFailureSummaryCalls).toHaveLength(1);
    expect(testState.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-3",
        chatId: 303,
        error: "telegram down"
      }),
      "failed to send scheduled sync-content failure summary to telegram"
    );
  });
});

async function runEntrypoint(): Promise<number> {
  vi.resetModules();
  const exitCodes: number[] = [];

  const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
    code?: string | number | null | undefined
  ) => {
    exitCodes.push(Number(code ?? 0));
    return undefined as never;
  }) as never);

  try {
    await import("./run-sync-content-job.ts");
    const lastCode = exitCodes.at(-1);

    if (lastCode === undefined) {
      throw new Error("Expected entrypoint to call process.exit");
    }

    return lastCode;
  } finally {
    exitSpy.mockRestore();
  }
}
