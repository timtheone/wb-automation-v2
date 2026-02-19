import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createProcessAllShopsService,
  type Database,
  type Shop,
  type ShopRepository
} from "./index.js";

interface ApiResponse<TData> {
  data?: TData;
  response: Response;
}

interface MockWbFbsClient {
  GET(path: string, options?: unknown): Promise<ApiResponse<unknown>>;
  POST(path: string, options?: unknown): Promise<ApiResponse<unknown>>;
  PATCH(path: string, options?: unknown): Promise<ApiResponse<unknown>>;
}

const testState = vi.hoisted(() => {
  return {
    shops: null as Pick<ShopRepository, "listActiveShops"> | null,
    createClient: null as
      | ((options: { token: string; baseUrl?: string }) => MockWbFbsClient)
      | null
  };
});

vi.mock("@wb-automation-v2/db", async () => {
  return {
    createShopRepository: () => {
      if (!testState.shops) {
        throw new Error("Shop repository mock is not configured");
      }

      return testState.shops;
    }
  };
});

vi.mock("@wb-automation-v2/wb-clients", async () => {
  return {
    WB_FBS_SANDBOX_API_BASE_URL: "https://marketplace-api-sandbox.wildberries.ru",
    createWbFbsClient: (options: { token: string; baseUrl?: string }) => {
      if (!testState.createClient) {
        throw new Error("WB FBS client mock is not configured");
      }

      return testState.createClient(options);
    }
  };
});

function createSingleShopRepo(overrides?: Partial<Shop>): Pick<ShopRepository, "listActiveShops"> {
  return {
    async listActiveShops() {
      return [
        {
          id: "shop-1",
          name: "Shop One",
          wbToken: "token-1",
          wbSandboxToken: null,
          useSandbox: false,
          isActive: true,
          supplyPrefix: "pref_",
          tokenUpdatedAt: new Date("2026-01-01T00:00:00.000Z"),
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
          ...overrides
        } satisfies Shop
      ];
    }
  };
}

function createClient(overrides: Partial<MockWbFbsClient>): MockWbFbsClient {
  return {
    async GET(path: string) {
      throw new Error(`Unexpected GET ${path}`);
    },
    async POST(path: string) {
      throw new Error(`Unexpected POST ${path}`);
    },
    async PATCH(path: string) {
      throw new Error(`Unexpected PATCH ${path}`);
    },
    ...overrides
  };
}

describe("process all shops service", () => {
  beforeEach(() => {
    testState.shops = null;
    testState.createClient = null;
  });

  it("creates delivery batch for eligible orders", async () => {
    testState.shops = createSingleShopRepo();

    const attachedBatches: number[][] = [];
    let barcodeQueryType: string | undefined;

    testState.createClient = () =>
      createClient({
        async GET(path, options) {
          if (path === "/api/v3/orders/new") {
            return {
              data: {
                orders: [
                  { id: 1, requiredMeta: null },
                  { id: 2, requiredMeta: [] },
                  { id: 3, requiredMeta: ["uin"] }
                ]
              },
              response: new Response(null, { status: 200 })
            };
          }

          if (path === "/api/v3/supplies") {
            return {
              data: {
                next: 0,
                supplies: [{ id: "SUP-1", done: false, name: "pref_20260101_0000" }]
              },
              response: new Response(null, { status: 200 })
            };
          }

          if (path === "/api/v3/supplies/{supplyId}") {
            return {
              data: { id: "SUP-1", done: true },
              response: new Response(null, { status: 200 })
            };
          }

          if (path === "/api/v3/supplies/{supplyId}/barcode") {
            barcodeQueryType = (options as { params?: { query?: { type?: string } } })?.params?.query?.type;

            return {
              data: { barcode: "SUP-1", file: "base64" },
              response: new Response(null, { status: 200 })
            };
          }

          throw new Error(`Unexpected GET ${path}`);
        },

        async PATCH(path, options) {
          if (path === "/api/marketplace/v3/supplies/{supplyId}/orders") {
            const body = (options as { body?: { orders?: number[] } })?.body;
            attachedBatches.push((body?.orders ?? []).filter((value): value is number => typeof value === "number"));

            return { response: new Response(null, { status: 204 }) };
          }

          if (path === "/api/v3/supplies/{supplyId}/deliver") {
            return { response: new Response(null, { status: 204 }) };
          }

          throw new Error(`Unexpected PATCH ${path}`);
        }
      });

    const service = createProcessAllShopsService({
      tenantId: "tenant-1",
      db: {} as Database,
      sleep: async () => {
        return;
      }
    });

    const result = await service.processAllShops();

    expect(result.successCount).toBe(1);
    expect(result.failureCount).toBe(0);
    expect(result.skippedCount).toBe(0);
    expect(result.results[0]?.ordersInNew).toBe(3);
    expect(result.results[0]?.ordersSkippedByMeta).toBe(1);
    expect(result.results[0]?.ordersAttached).toBe(2);
    expect(attachedBatches).toEqual([[1, 2]]);
    expect(barcodeQueryType).toBe("png");
  });

  it("marks shop as skipped when every order requires metadata", async () => {
    testState.shops = createSingleShopRepo();

    const debugEvents: Array<{ step?: string; responseData?: Record<string, unknown> }> = [];

    testState.createClient = () =>
      createClient({
        async GET(path) {
          if (path === "/api/v3/orders/new") {
            return {
              data: {
                orders: [{ id: 1, requiredMeta: ["sgtin"] }]
              },
              response: new Response(null, { status: 200 })
            };
          }

          throw new Error(`Unexpected GET ${path}`);
        }
      });

    const service = createProcessAllShopsService({
      tenantId: "tenant-1",
      db: {} as Database,
      onWbApiDebug(event) {
        debugEvents.push({
          step: event.step,
          responseData: event.responseData
        });
      }
    });

    const result = await service.processAllShops();

    expect(result.successCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.results[0]?.status).toBe("skipped");
    expect(debugEvents.some((event) => event.step === "orders_new")).toBe(true);
    expect(debugEvents.some((event) => event.step === "orders_new_no_eligible")).toBe(true);
    expect(debugEvents.find((event) => event.step === "orders_new")?.responseData?.totalOrders).toBe(1);
  });

  it("uses sandbox FBS endpoint and sandbox token when shop is configured for sandbox", async () => {
    testState.shops = createSingleShopRepo({
      wbToken: "prod-token",
      wbSandboxToken: "sandbox-token",
      useSandbox: true
    });

    testState.createClient = (options) => {
      expect(options.token).toBe("sandbox-token");
      expect(options.baseUrl).toBe("https://marketplace-api-sandbox.wildberries.ru");

      return createClient({
        async GET(path) {
          if (path === "/api/v3/orders/new") {
            return {
              data: { orders: [] },
              response: new Response(null, { status: 200 })
            };
          }

          throw new Error(`Unexpected GET ${path}`);
        }
      });
    };

    const service = createProcessAllShopsService({
      tenantId: "tenant-1",
      db: {} as Database
    });

    const result = await service.processAllShops();

    expect(result.skippedCount).toBe(1);
    expect(result.failureCount).toBe(0);
  });

  it("creates supply with deterministic prefix+timestamp name", async () => {
    testState.shops = createSingleShopRepo({ supplyPrefix: "toys_" });

    const createdSupplyNames: string[] = [];

    testState.createClient = () =>
      createClient({
        async GET(path) {
          if (path === "/api/v3/orders/new") {
            return {
              data: {
                orders: [{ id: 42, requiredMeta: [] }]
              },
              response: new Response(null, { status: 200 })
            };
          }

          if (path === "/api/v3/supplies") {
            return {
              data: {
                next: 0,
                supplies: []
              },
              response: new Response(null, { status: 200 })
            };
          }

          if (path === "/api/v3/supplies/{supplyId}") {
            return {
              data: { id: "SUP-CREATED", done: true },
              response: new Response(null, { status: 200 })
            };
          }

          if (path === "/api/v3/supplies/{supplyId}/barcode") {
            return {
              data: { barcode: "SUP-CREATED", file: "base64" },
              response: new Response(null, { status: 200 })
            };
          }

          throw new Error(`Unexpected GET ${path}`);
        },

        async POST(path, options) {
          if (path !== "/api/v3/supplies") {
            throw new Error(`Unexpected POST ${path}`);
          }

          const body = (options as { body?: { name?: string } })?.body;
          createdSupplyNames.push(body?.name ?? "");

          return {
            data: { id: "SUP-CREATED" },
            response: new Response(null, { status: 201 })
          };
        },

        async PATCH(path) {
          if (path === "/api/marketplace/v3/supplies/{supplyId}/orders") {
            return { response: new Response(null, { status: 204 }) };
          }

          if (path === "/api/v3/supplies/{supplyId}/deliver") {
            return { response: new Response(null, { status: 204 }) };
          }

          throw new Error(`Unexpected PATCH ${path}`);
        }
      });

    const service = createProcessAllShopsService({
      tenantId: "tenant-1",
      db: {} as Database,
      now: () => new Date("2026-03-04T05:06:00.000Z")
    });

    const result = await service.processAllShops();

    expect(result.successCount).toBe(1);
    expect(createdSupplyNames).toEqual(["toys_20260304_0506"]);
  });

  it("reuses existing matching open supply and does not create new one", async () => {
    testState.shops = createSingleShopRepo({ supplyPrefix: "toys_" });

    const createSupplyCalls: string[] = [];

    testState.createClient = () =>
      createClient({
        async GET(path, options) {
          if (path === "/api/v3/orders/new") {
            return {
              data: { orders: [{ id: 10, requiredMeta: null }] },
              response: new Response(null, { status: 200 })
            };
          }

          if (path === "/api/v3/supplies") {
            return {
              data: {
                next: 0,
                supplies: [
                  { id: "SUP-OTHER", done: false, name: "other_20260101_0000" },
                  { id: "SUP-TOYS", done: false, name: "toys_20260102_0000" }
                ]
              },
              response: new Response(null, { status: 200 })
            };
          }

          if (path === "/api/v3/supplies/{supplyId}") {
            const supplyId = (options as { params?: { path?: { supplyId?: string } } })?.params?.path?.supplyId;
            expect(supplyId).toBe("SUP-TOYS");

            return {
              data: { id: "SUP-TOYS", done: true },
              response: new Response(null, { status: 200 })
            };
          }

          if (path === "/api/v3/supplies/{supplyId}/barcode") {
            const supplyId = (options as { params?: { path?: { supplyId?: string } } })?.params?.path?.supplyId;
            expect(supplyId).toBe("SUP-TOYS");

            return {
              data: { barcode: "SUP-TOYS", file: "base64" },
              response: new Response(null, { status: 200 })
            };
          }

          throw new Error(`Unexpected GET ${path}`);
        },

        async POST(path, options) {
          if (path !== "/api/v3/supplies") {
            throw new Error(`Unexpected POST ${path}`);
          }

          const body = (options as { body?: { name?: string } })?.body;
          createSupplyCalls.push(body?.name ?? "");

          return {
            data: { id: "SHOULD-NOT-HAPPEN" },
            response: new Response(null, { status: 201 })
          };
        },

        async PATCH(path, options) {
          const supplyId = (options as { params?: { path?: { supplyId?: string } } })?.params?.path?.supplyId;
          expect(supplyId).toBe("SUP-TOYS");

          if (path === "/api/marketplace/v3/supplies/{supplyId}/orders") {
            return { response: new Response(null, { status: 204 }) };
          }

          if (path === "/api/v3/supplies/{supplyId}/deliver") {
            return { response: new Response(null, { status: 204 }) };
          }

          throw new Error(`Unexpected PATCH ${path}`);
        }
      });

    const service = createProcessAllShopsService({
      tenantId: "tenant-1",
      db: {} as Database
    });

    const result = await service.processAllShops();

    expect(result.successCount).toBe(1);
    expect(result.results[0]?.supplyId).toBe("SUP-TOYS");
    expect(createSupplyCalls).toEqual([]);
  });

  it("fetches all supplies pages and can find open supply on later page", async () => {
    testState.shops = createSingleShopRepo({ supplyPrefix: "toys_" });

    const getSuppliesQueries: Array<{ limit: number; next: number }> = [];
    const createSupplyCalls: string[] = [];

    testState.createClient = () =>
      createClient({
        async GET(path, options) {
          if (path === "/api/v3/orders/new") {
            return {
              data: { orders: [{ id: 100, requiredMeta: [] }] },
              response: new Response(null, { status: 200 })
            };
          }

          if (path === "/api/v3/supplies") {
            const query = (options as { params?: { query?: { limit: number; next: number } } })?.params?.query;

            if (!query) {
              throw new Error("Query is required for supplies paging test");
            }

            getSuppliesQueries.push({ limit: query.limit, next: query.next });

            if (query.next === 0) {
              return {
                data: {
                  next: 5,
                  supplies: [{ id: "SUP-OTHER", done: false, name: "other_1" }]
                },
                response: new Response(null, { status: 200 })
              };
            }

            return {
              data: {
                next: 0,
                supplies: [{ id: "SUP-LATE", done: false, name: "toys_20260103_0000" }]
              },
              response: new Response(null, { status: 200 })
            };
          }

          if (path === "/api/v3/supplies/{supplyId}") {
            return {
              data: { id: "SUP-LATE", done: true },
              response: new Response(null, { status: 200 })
            };
          }

          if (path === "/api/v3/supplies/{supplyId}/barcode") {
            return {
              data: { barcode: "SUP-LATE", file: "base64" },
              response: new Response(null, { status: 200 })
            };
          }

          throw new Error(`Unexpected GET ${path}`);
        },

        async POST(path, options) {
          if (path !== "/api/v3/supplies") {
            throw new Error(`Unexpected POST ${path}`);
          }

          const body = (options as { body?: { name?: string } })?.body;
          createSupplyCalls.push(body?.name ?? "");

          return {
            data: { id: "SHOULD-NOT-HAPPEN" },
            response: new Response(null, { status: 201 })
          };
        },

        async PATCH(path) {
          if (path === "/api/marketplace/v3/supplies/{supplyId}/orders") {
            return { response: new Response(null, { status: 204 }) };
          }

          if (path === "/api/v3/supplies/{supplyId}/deliver") {
            return { response: new Response(null, { status: 204 }) };
          }

          throw new Error(`Unexpected PATCH ${path}`);
        }
      });

    const service = createProcessAllShopsService({
      tenantId: "tenant-1",
      db: {} as Database,
      supplyPageLimit: 2
    });

    const result = await service.processAllShops();

    expect(result.successCount).toBe(1);
    expect(result.results[0]?.supplyId).toBe("SUP-LATE");
    expect(getSuppliesQueries).toEqual([
      { limit: 2, next: 0 },
      { limit: 2, next: 5 }
    ]);
    expect(createSupplyCalls).toEqual([]);
  });

  it("skips when there are no new orders", async () => {
    testState.shops = createSingleShopRepo();

    const getSuppliesCalls: number[] = [];

    testState.createClient = () =>
      createClient({
        async GET(path) {
          if (path === "/api/v3/orders/new") {
            return {
              data: { orders: [] },
              response: new Response(null, { status: 200 })
            };
          }

          if (path === "/api/v3/supplies") {
            getSuppliesCalls.push(1);
            throw new Error("must not be called");
          }

          throw new Error(`Unexpected GET ${path}`);
        }
      });

    const service = createProcessAllShopsService({
      tenantId: "tenant-1",
      db: {} as Database
    });

    const result = await service.processAllShops();

    expect(result.skippedCount).toBe(1);
    expect(result.results[0]?.ordersInNew).toBe(0);
    expect(getSuppliesCalls).toEqual([]);
  });

  it("splits attached orders into batches of 100", async () => {
    testState.shops = createSingleShopRepo();

    const attachedBatches: number[][] = [];

    testState.createClient = () =>
      createClient({
        async GET(path) {
          if (path === "/api/v3/orders/new") {
            return {
              data: {
                orders: Array.from({ length: 205 }, (_, index) => ({
                  id: index + 1,
                  requiredMeta: []
                }))
              },
              response: new Response(null, { status: 200 })
            };
          }

          if (path === "/api/v3/supplies") {
            return {
              data: {
                next: 0,
                supplies: [{ id: "SUP-BATCH", done: false, name: "pref_20260101_0000" }]
              },
              response: new Response(null, { status: 200 })
            };
          }

          if (path === "/api/v3/supplies/{supplyId}") {
            return {
              data: { id: "SUP-BATCH", done: true },
              response: new Response(null, { status: 200 })
            };
          }

          if (path === "/api/v3/supplies/{supplyId}/barcode") {
            return {
              data: { barcode: "SUP-BATCH", file: "base64" },
              response: new Response(null, { status: 200 })
            };
          }

          throw new Error(`Unexpected GET ${path}`);
        },
        async PATCH(path, options) {
          if (path === "/api/marketplace/v3/supplies/{supplyId}/orders") {
            const body = (options as { body?: { orders?: number[] } })?.body;
            attachedBatches.push((body?.orders ?? []).filter((value): value is number => typeof value === "number"));

            return { response: new Response(null, { status: 204 }) };
          }

          if (path === "/api/v3/supplies/{supplyId}/deliver") {
            return { response: new Response(null, { status: 204 }) };
          }

          throw new Error(`Unexpected PATCH ${path}`);
        }
      });

    const service = createProcessAllShopsService({
      tenantId: "tenant-1",
      db: {} as Database
    });

    const result = await service.processAllShops();

    expect(result.successCount).toBe(1);
    expect(result.results[0]?.ordersAttached).toBe(205);
    expect(attachedBatches.map((batch) => batch.length)).toEqual([100, 100, 5]);
    expect(attachedBatches[0]?.[0]).toBe(1);
    expect(attachedBatches[2]?.[4]).toBe(205);
  });

  it("marks shop as failed when supply closing poll times out", async () => {
    testState.shops = createSingleShopRepo();

    const sleepCalls: number[] = [];
    let pollCalls = 0;

    testState.createClient = () =>
      createClient({
        async GET(path) {
          if (path === "/api/v3/orders/new") {
            return {
              data: {
                orders: [{ id: 1, requiredMeta: [] }]
              },
              response: new Response(null, { status: 200 })
            };
          }

          if (path === "/api/v3/supplies") {
            return {
              data: {
                next: 0,
                supplies: [{ id: "SUP-POLL", done: false, name: "pref_20260101_0000" }]
              },
              response: new Response(null, { status: 200 })
            };
          }

          if (path === "/api/v3/supplies/{supplyId}") {
            pollCalls += 1;

            return {
              data: { id: "SUP-POLL", done: false },
              response: new Response(null, { status: 200 })
            };
          }

          if (path === "/api/v3/supplies/{supplyId}/barcode") {
            throw new Error("must not fetch barcode after timeout");
          }

          throw new Error(`Unexpected GET ${path}`);
        },
        async PATCH(path) {
          if (path === "/api/marketplace/v3/supplies/{supplyId}/orders") {
            return { response: new Response(null, { status: 204 }) };
          }

          if (path === "/api/v3/supplies/{supplyId}/deliver") {
            return { response: new Response(null, { status: 204 }) };
          }

          throw new Error(`Unexpected PATCH ${path}`);
        }
      });

    const service = createProcessAllShopsService({
      tenantId: "tenant-1",
      db: {} as Database,
      maxPollAttempts: 3,
      pollIntervalMs: 250,
      sleep: async (ms) => {
        sleepCalls.push(ms);
      }
    });

    const result = await service.processAllShops();

    expect(result.successCount).toBe(0);
    expect(result.failureCount).toBe(1);
    expect(result.results[0]?.status).toBe("failed");
    expect(result.results[0]?.error).toBe("Timed out waiting for supply SUP-POLL to close");
    expect(pollCalls).toBe(3);
    expect(sleepCalls).toEqual([250, 250]);
  });
});
