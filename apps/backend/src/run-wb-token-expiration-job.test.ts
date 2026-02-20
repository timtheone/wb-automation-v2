import { beforeEach, describe, expect, it, vi } from "vitest";

type TokenCheckPlan =
  | {
      processedShops: number;
      warnings: Array<{
        shopId: string;
        shopName: string;
        tokenType: "production";
        expiresAt: Date;
        daysLeft: number;
      }>;
      invalidTokens: Array<{
        shopId: string;
        shopName: string;
        tokenType: "production";
        reason: string;
      }>;
      expiredTokensCount: number;
    }
  | Error;

const testState = vi.hoisted(() => ({
  tenantContexts: [] as Array<{ tenantId: string; ownerTelegramUserId: number }>,
  plans: new Map<string, TokenCheckPlan>(),
  createServiceCalls: [] as Array<{ tenantId: string; warningThresholdDays: number | undefined }>,
  sendWarningsCalls: [] as Array<{ chatId: number; warningsCount: number }>,
  dbEnd: vi.fn(),
  loggerInfo: vi.fn(),
  loggerError: vi.fn()
}));

vi.mock("@wb-automation-v2/core", async () => {
  return {
    createCheckWbTokenExpirationService: ({
      tenantId,
      warningThresholdDays
    }: {
      tenantId: string;
      warningThresholdDays?: number;
    }) => {
      testState.createServiceCalls.push({ tenantId, warningThresholdDays });

      return {
        async checkWbTokenExpiration() {
          const plan = testState.plans.get(tenantId);

          if (!plan) {
            throw new Error(`No token check plan for ${tenantId}`);
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
      async sendWbTokenExpirationWarnings(chatId: number, warnings: Array<unknown>) {
        testState.sendWarningsCalls.push({ chatId, warningsCount: warnings.length });
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

describe("run-wb-token-expiration-job entrypoint", () => {
  beforeEach(() => {
    testState.tenantContexts = [];
    testState.plans.clear();
    testState.createServiceCalls = [];
    testState.sendWarningsCalls = [];
    testState.dbEnd.mockReset();
    testState.loggerInfo.mockReset();
    testState.loggerError.mockReset();
  });

  it("exits with code 0 when there are no tenants", async () => {
    const code = await runEntrypoint();

    expect(code).toBe(0);
    expect(testState.createServiceCalls).toEqual([]);
    expect(testState.sendWarningsCalls).toEqual([]);
    expect(testState.dbEnd).toHaveBeenCalled();
  });

  it("checks every tenant and notifies only those with warnings", async () => {
    testState.tenantContexts = [
      { tenantId: "tenant-1", ownerTelegramUserId: 111 },
      { tenantId: "tenant-2", ownerTelegramUserId: 222 }
    ];

    testState.plans.set("tenant-1", {
      processedShops: 2,
      warnings: [
        {
          shopId: "shop-1",
          shopName: "Shop One",
          tokenType: "production",
          expiresAt: new Date("2026-02-23T00:00:00.000Z"),
          daysLeft: 3
        }
      ],
      invalidTokens: [],
      expiredTokensCount: 0
    });
    testState.plans.set("tenant-2", {
      processedShops: 1,
      warnings: [],
      invalidTokens: [
        {
          shopId: "shop-x",
          shopName: "Shop X",
          tokenType: "production",
          reason: "token is not a JWT"
        }
      ],
      expiredTokensCount: 1
    });

    const code = await runEntrypoint();

    expect(code).toBe(0);
    expect(testState.createServiceCalls).toEqual([
      { tenantId: "tenant-1", warningThresholdDays: 4 },
      { tenantId: "tenant-2", warningThresholdDays: 4 }
    ]);
    expect(testState.sendWarningsCalls).toEqual([{ chatId: 111, warningsCount: 1 }]);
    expect(testState.dbEnd).toHaveBeenCalledTimes(1);
  });

  it("exits with code 1 when token check throws", async () => {
    testState.tenantContexts = [{ tenantId: "tenant-err", ownerTelegramUserId: 999 }];
    testState.plans.set("tenant-err", new Error("token decode failed"));

    const code = await runEntrypoint();

    expect(code).toBe(1);
    expect(testState.sendWarningsCalls).toEqual([]);
    expect(testState.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "token decode failed"
      }),
      "job failed"
    );
    expect(testState.dbEnd).toHaveBeenCalledTimes(1);
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
    await import("./run-wb-token-expiration-job.ts");
    const lastCode = exitCodes.at(-1);

    if (lastCode === undefined) {
      throw new Error("Expected entrypoint to call process.exit");
    }

    return lastCode;
  } finally {
    exitSpy.mockRestore();
  }
}
