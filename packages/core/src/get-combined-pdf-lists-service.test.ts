import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createGetCombinedPdfListsService,
  createGetWaitingOrdersPdfListsService,
  type Database,
  type ProductCard,
  type ProductCardRepository,
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
}

const testState = vi.hoisted(() => {
  return {
    shops: null as Pick<ShopRepository, "listActiveShops"> | null,
    productCards: null as Pick<ProductCardRepository, "getByShopIdAndNmIds"> | null,
    createClient: null as
      | ((options: { token: string; baseUrl?: string }) => MockWbFbsClient)
      | null
  };
});

vi.mock("@wb-automation-v2/db", async () => {
  return {
    createDbRepositories: () => {
      if (!testState.shops || !testState.productCards) {
        throw new Error("DB repositories mock is not configured");
      }

      return {
        shops: testState.shops,
        productCards: testState.productCards,
        syncState: {} as never
      };
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

function createClient(overrides: Partial<MockWbFbsClient>): MockWbFbsClient {
  return {
    async GET(path: string) {
      throw new Error(`Unexpected GET ${path}`);
    },
    async POST(path: string) {
      throw new Error(`Unexpected POST ${path}`);
    },
    ...overrides
  };
}

function createShop(overrides: Partial<Shop>): Shop {
  return {
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
  };
}

function pdfBase64ToHeader(value: string): string {
  return Buffer.from(value, "base64").subarray(0, 4).toString("ascii");
}

describe("get combined pdf lists service", () => {
  beforeEach(() => {
    testState.shops = null;
    testState.productCards = null;
    testState.createClient = null;
  });

  it("enriches rows with product cards and returns generated PDFs", async () => {
    testState.shops = {
      async listActiveShops() {
        return [createShop({ id: "shop-a", name: "Shop A" })];
      }
    };

    const requestedNmIds: number[][] = [];

    testState.productCards = {
      async getByShopIdAndNmIds(shopId: string, nmIds: number[]): Promise<ProductCard[]> {
        expect(shopId).toBe("shop-a");
        requestedNmIds.push([...nmIds]);

        return [
          {
            shopId,
            nmId: 101,
            vendorCode: null,
            brand: "Lego",
            title: "Car",
            img: null,
            ageGroup: "6+",
            wbCreatedAt: null,
            wbUpdatedAt: null,
            syncedAt: new Date("2026-01-01T00:00:00.000Z")
          }
        ];
      }
    };

    const fetchedSupplyIds: string[] = [];

    testState.createClient = () =>
      createClient({
        async GET(path, options) {
          if (path === "/api/v3/supplies") {
            return {
              data: {
                next: 0,
                supplies: [
                  { id: "SUP-OLD", done: true, name: "pref_1", closedAt: "2026-01-02T00:00:00.000Z" },
                  { id: "SUP-NEW", done: true, name: "pref_2", closedAt: "2026-01-03T00:00:00.000Z" }
                ]
              },
              response: new Response(null, { status: 200 })
            };
          }

          if (path === "/api/marketplace/v3/supplies/{supplyId}/order-ids") {
            const supplyId = (options as { params?: { path?: { supplyId?: string } } })?.params?.path?.supplyId;

            if (typeof supplyId === "string") {
              fetchedSupplyIds.push(supplyId);
            }

            return {
              data: {
                orderIds: supplyId === "SUP-NEW" ? [5001, 5002] : [5003]
              },
              response: new Response(null, { status: 200 })
            };
          }

          if (path === "/api/v3/orders") {
            return {
              data: {
                next: 0,
                orders: [
                  { id: 5001, nmId: 101 },
                  { id: 5002, nmId: 102 },
                  { id: 5003, nmId: 103 }
                ]
              },
              response: new Response(null, { status: 200 })
            };
          }

          throw new Error(`Unexpected GET ${path}`);
        },

        async POST(path) {
          if (path !== "/api/v3/orders/stickers") {
            throw new Error(`Unexpected POST ${path}`);
          }

          return {
            data: {
              stickers: [
                {
                  orderId: 5001,
                  partA: 111,
                  partB: 222,
                  file: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg=="
                }
              ]
            },
            response: new Response(null, { status: 200 })
          };
        }
      });

    const service = createGetCombinedPdfListsService({
      tenantId: "tenant-1",
      db: {} as Database,
      now: () => new Date("2026-02-19T11:15:00.000Z"),
      fetchImage: async () => {
        throw new Error("image download not expected");
      }
    });

    const result = await service.getCombinedPdfLists();

    expect(result.successCount).toBe(1);
    expect(result.totalOrdersCollected).toBe(2);
    expect(result.results[0]).toMatchObject({
      shopId: "shop-a",
      status: "success",
      supplyIds: ["SUP-NEW"],
      orderIds: [5001, 5002],
      ordersCollected: 2,
      missingProductCards: 1
    });
    expect(result.orderListFileName).toBe("Лист-подбора_19_февраля.pdf");
    expect(result.stickersFileName).toBe("Стикеры_19_февраля.pdf");
    expect(pdfBase64ToHeader(result.orderListPdfBase64)).toBe("%PDF");
    expect(pdfBase64ToHeader(result.stickersPdfBase64)).toBe("%PDF");
    expect(requestedNmIds).toEqual([[101, 102]]);
    expect(fetchedSupplyIds).toEqual(["SUP-NEW"]);
  });

  it("uses sandbox token and returns skipped when no completed prefixed supplies exist", async () => {
    testState.shops = {
      async listActiveShops() {
        return [
          createShop({
            id: "shop-sandbox",
            wbToken: "prod-token",
            wbSandboxToken: "sandbox-token",
            useSandbox: true
          })
        ];
      }
    };

    testState.productCards = {
      async getByShopIdAndNmIds() {
        throw new Error("must not query product cards for skipped shop");
      }
    };

    testState.createClient = ({ token, baseUrl }) => {
      expect(token).toBe("sandbox-token");
      expect(baseUrl).toBe("https://marketplace-api-sandbox.wildberries.ru");

      return createClient({
        async GET(path) {
          if (path === "/api/v3/supplies") {
            return {
              data: {
                next: 0,
                supplies: [{ id: "SUP-1", done: false, name: "pref_1" }]
              },
              response: new Response(null, { status: 200 })
            };
          }

          throw new Error(`Unexpected GET ${path}`);
        }
      });
    };

    const service = createGetCombinedPdfListsService({
      tenantId: "tenant-1",
      db: {} as Database
    });

    const result = await service.getCombinedPdfLists();

    expect(result.successCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.results[0]).toMatchObject({
      shopId: "shop-sandbox",
      status: "skipped",
      ordersCollected: 0,
      missingProductCards: 0
    });
    expect(pdfBase64ToHeader(result.orderListPdfBase64)).toBe("%PDF");
    expect(pdfBase64ToHeader(result.stickersPdfBase64)).toBe("%PDF");
  });

  it("filters waiting orders and excludes newest supply for waiting flow", async () => {
    testState.shops = {
      async listActiveShops() {
        return [createShop({ id: "shop-a", name: "Shop A" })];
      }
    };

    const requestedNmIds: number[][] = [];

    testState.productCards = {
      async getByShopIdAndNmIds(shopId: string, nmIds: number[]): Promise<ProductCard[]> {
        expect(shopId).toBe("shop-a");
        requestedNmIds.push([...nmIds]);

        return nmIds.map((nmId) => ({
          shopId,
          nmId,
          vendorCode: null,
          brand: `Brand ${nmId}`,
          title: `Title ${nmId}`,
          img: null,
          ageGroup: "6+",
          wbCreatedAt: null,
          wbUpdatedAt: null,
          syncedAt: new Date("2026-01-01T00:00:00.000Z")
        }));
      }
    };

    const fetchedSupplyIds: string[] = [];
    const statusBatches: number[][] = [];

    testState.createClient = () =>
      createClient({
        async GET(path, options) {
          if (path === "/api/v3/supplies") {
            return {
              data: {
                next: 0,
                supplies: [
                  { id: "SUP-OLD", done: true, name: "pref_1", closedAt: "2026-01-03T00:00:00.000Z" },
                  { id: "SUP-OLDER", done: true, name: "pref_2", closedAt: "2026-01-02T00:00:00.000Z" },
                  { id: "SUP-OLDEST", done: true, name: "pref_3", closedAt: "2026-01-01T00:00:00.000Z" }
                ]
              },
              response: new Response(null, { status: 200 })
            };
          }

          if (path === "/api/marketplace/v3/supplies/{supplyId}/order-ids") {
            const supplyId = (options as { params?: { path?: { supplyId?: string } } })?.params?.path?.supplyId;

            if (typeof supplyId === "string") {
              fetchedSupplyIds.push(supplyId);
            }

            return {
              data: {
                orderIds:
                  supplyId === "SUP-OLDER"
                    ? [9002, 9003]
                    : supplyId === "SUP-OLDEST"
                      ? [9004]
                      : [9001]
              },
              response: new Response(null, { status: 200 })
            };
          }

          if (path === "/api/v3/orders") {
            return {
              data: {
                next: 0,
                orders: [
                  { id: 9001, nmId: 2001 },
                  { id: 9002, nmId: 2002 },
                  { id: 9003, nmId: 2003 },
                  { id: 9004, nmId: 2004 }
                ]
              },
              response: new Response(null, { status: 200 })
            };
          }

          throw new Error(`Unexpected GET ${path}`);
        },

        async POST(path, options) {
          if (path === "/api/v3/orders/status") {
            const batch =
              (options as {
                body?: {
                  orders?: number[];
                };
              })?.body?.orders ?? [];
            statusBatches.push([...batch]);

            return {
              data: {
                orders: [
                  { id: 9002, wbStatus: "waiting" },
                  { id: 9003, wbStatus: "sorted" },
                  { id: 9004, wbStatus: "waiting" }
                ]
              },
              response: new Response(null, { status: 200 })
            };
          }

          if (path === "/api/v3/orders/stickers") {
            return {
              data: {
                stickers: [
                  {
                    orderId: 9002,
                    partA: 111,
                    partB: 222,
                    file: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg=="
                  },
                  {
                    orderId: 9004,
                    partA: 333,
                    partB: 444,
                    file: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg=="
                  }
                ]
              },
              response: new Response(null, { status: 200 })
            };
          }

          throw new Error(`Unexpected POST ${path}`);
        }
      });

    const service = createGetWaitingOrdersPdfListsService({
      tenantId: "tenant-1",
      db: {} as Database,
      now: () => new Date("2026-02-19T11:15:00.000Z"),
      fetchImage: async () => {
        throw new Error("image download not expected");
      }
    });

    const result = await service.getWaitingOrdersPdfLists();

    expect(result.successCount).toBe(1);
    expect(result.totalOrdersCollected).toBe(2);
    expect(result.results[0]).toMatchObject({
      shopId: "shop-a",
      status: "success",
      supplyIds: ["SUP-OLDER", "SUP-OLDEST"],
      orderIds: [9002, 9004],
      ordersCollected: 2,
      missingProductCards: 0
    });
    expect(result.orderListFileName).toBe("Лист-подбора-ожидающие_19_февраля.pdf");
    expect(result.stickersFileName).toBe("Стикеры-ожидающие_19_февраля.pdf");
    expect(pdfBase64ToHeader(result.orderListPdfBase64)).toBe("%PDF");
    expect(pdfBase64ToHeader(result.stickersPdfBase64)).toBe("%PDF");
    expect(requestedNmIds).toEqual([[2002, 2004]]);
    expect(fetchedSupplyIds).toEqual(["SUP-OLDER", "SUP-OLDEST"]);
    expect(statusBatches).toEqual([[9002, 9003, 9004]]);
  });

  it("keeps processing other shops when one shop fails", async () => {
    testState.shops = {
      async listActiveShops() {
        return [
          createShop({ id: "shop-failed", name: "Failed", wbToken: "token-f" }),
          createShop({ id: "shop-ok", name: "OK", wbToken: "token-ok" })
        ];
      }
    };

    testState.productCards = {
      async getByShopIdAndNmIds(shopId, nmIds) {
        return nmIds.map((nmId) => ({
          shopId,
          nmId,
          vendorCode: null,
          brand: "Brand",
          title: `Title ${nmId}`,
          img: null,
          ageGroup: null,
          wbCreatedAt: null,
          wbUpdatedAt: null,
          syncedAt: new Date("2026-01-01T00:00:00.000Z")
        }));
      }
    };

    testState.createClient = ({ token }) =>
      createClient({
        async GET(path, options) {
          if (path === "/api/v3/supplies") {
            return {
              data: {
                next: 0,
                supplies: [{ id: token === "token-f" ? "SUP-F" : "SUP-OK", done: true, name: "pref_1" }]
              },
              response: new Response(null, { status: 200 })
            };
          }

          if (path === "/api/marketplace/v3/supplies/{supplyId}/order-ids") {
            const supplyId = (options as { params?: { path?: { supplyId?: string } } })?.params?.path?.supplyId;

            if (supplyId === "SUP-F") {
              throw new Error("wb api unavailable");
            }

            return {
              data: { orderIds: [1001] },
              response: new Response(null, { status: 200 })
            };
          }

          if (path === "/api/v3/orders") {
            return {
              data: {
                next: 0,
                orders: [{ id: 1001, nmId: 777 }]
              },
              response: new Response(null, { status: 200 })
            };
          }

          throw new Error(`Unexpected GET ${path}`);
        },

        async POST(path) {
          if (path !== "/api/v3/orders/stickers") {
            throw new Error(`Unexpected POST ${path}`);
          }

          return {
            data: { stickers: [] },
            response: new Response(null, { status: 200 })
          };
        }
      });

    const service = createGetCombinedPdfListsService({
      tenantId: "tenant-1",
      db: {} as Database
    });

    const result = await service.getCombinedPdfLists();

    expect(result.processedShops).toBe(2);
    expect(result.successCount).toBe(1);
    expect(result.failureCount).toBe(1);
    expect(result.results.find((item) => item.shopId === "shop-failed")).toMatchObject({
      status: "failed",
      error: "wb api unavailable"
    });
    expect(result.results.find((item) => item.shopId === "shop-ok")).toMatchObject({
      status: "success",
      ordersCollected: 1,
      missingProductCards: 0
    });
    expect(pdfBase64ToHeader(result.orderListPdfBase64)).toBe("%PDF");
    expect(pdfBase64ToHeader(result.stickersPdfBase64)).toBe("%PDF");
  });
});
