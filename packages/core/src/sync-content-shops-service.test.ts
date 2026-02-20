import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createSyncContentShopsService,
  type ProductCard,
  type ProductCardRepository,
  type ProductsClient,
  type Shop,
  type ShopRepository,
  type SyncState,
  type SyncStateRepository,
  type UpsertSyncStateInput
} from "./index.js";

const testState = vi.hoisted(() => {
  return {
    shops: null as Pick<ShopRepository, "listActiveShops"> | null,
    productCards: null as ProductCardRepository | null,
    syncState: null as SyncStateRepository | null,
    createClient: null as ((options: { token: string; baseUrl?: string }) => ProductsClient) | null
  };
});

vi.mock("@wb-automation-v2/db", async () => {
  return {
    createDbRepositories: () => {
      if (!testState.shops || !testState.productCards || !testState.syncState) {
        throw new Error("Db repositories mock is not configured");
      }

      return {
        shops: testState.shops!,
        productCards: testState.productCards!,
        syncState: testState.syncState!
      };
    }
  };
});

vi.mock("@wb-automation-v2/wb-clients", async () => {
  return {
    WB_PRODUCTS_API_BASE_URL: "https://content-api.wildberries.ru",
    WB_PRODUCTS_SANDBOX_API_BASE_URL: "https://content-api-sandbox.wildberries.ru",
    createWbProductsClient: (options: { token: string; baseUrl?: string }) => {
      if (!testState.createClient) {
        throw new Error("WB products client mock is not configured");
      }

      return testState.createClient(options);
    }
  };
});

describe("sync content shops service", () => {
  beforeEach(() => {
    testState.shops = null;
    testState.productCards = null;
    testState.syncState = null;
    testState.createClient = null;
  });

  it("syncs pages and updates cursor/state", async () => {
    const shopsRepo: Pick<ShopRepository, "listActiveShops"> = {
      async listActiveShops() {
        return [
          {
            id: "shop-1",
            name: "Shop One",
            wbToken: "token-1",
            wbSandboxToken: null,
            useSandbox: false,
            isActive: true,
            supplyPrefix: "игрушки_",
            tokenUpdatedAt: new Date("2026-01-01T00:00:00.000Z"),
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            updatedAt: new Date("2026-01-01T00:00:00.000Z")
          } satisfies Shop
        ];
      }
    };

    const upsertedCards: ProductCard[] = [];
    const productCardsRepo: ProductCardRepository = {
      async upsertMany(cards) {
        upsertedCards.push(...cards);
        return cards.length;
      },
      async getByShopIdAndNmIds() {
        return [];
      }
    };

    let storedState: SyncState | null = null;
    const syncStateRepo: SyncStateRepository = {
      async getByShopId() {
        return storedState;
      },
      async upsert(input: UpsertSyncStateInput) {
        storedState = {
          ...input
        };
      }
    };

    let call = 0;
    testState.createClient = ({ token, baseUrl }): ProductsClient => {
      expect(token).toBe("token-1");
      expect(baseUrl).toBe("https://content-api.wildberries.ru");

      return {
        async POST(_path, { body }) {
          call += 1;

          if (call === 1) {
            expect(body.settings?.cursor?.updatedAt).toBeUndefined();

            return {
              data: {
                cards: [
                  {
                    nmID: 10,
                    vendorCode: "vc-10",
                    brand: "Brand",
                    title: "Title 10",
                    photos: [{ big: "https://img/10" }],
                    characteristics: [{ name: "Возраст", value: ["6+"] }],
                    createdAt: "2026-01-01T00:00:00.000Z",
                    updatedAt: "2026-01-02T00:00:00.000Z"
                  }
                ],
                cursor: {
                  updatedAt: "2026-01-02T00:00:00.000Z",
                  nmID: 10,
                  total: 2
                }
              },
              response: new Response(null, { status: 200 })
            };
          }

          expect(body.settings?.cursor?.updatedAt).toBe("2026-01-02T00:00:00.000Z");
          expect(body.settings?.cursor?.nmID).toBe(10);

          return {
            data: {
              cards: [
                {
                  nmID: 11,
                  vendorCode: "vc-11",
                  title: "Title 11",
                  photos: [{ square: "https://img/11" }],
                  updatedAt: "2026-01-03T00:00:00.000Z"
                }
              ],
              cursor: {
                updatedAt: "2026-01-03T00:00:00.000Z",
                nmID: 11,
                total: 1
              }
            },
            response: new Response(null, { status: 200 })
          };
        }
      };
    };

    testState.shops = shopsRepo;
    testState.productCards = productCardsRepo;
    testState.syncState = syncStateRepo;

    const service = createSyncContentShopsService({
      tenantId: "tenant-1",
      pageLimit: 2,
      maxPagesPerShop: 10,
      betweenPagesDelayMs: 0,
      now: () => new Date("2026-01-10T00:00:00.000Z")
    });

    const result = await service.syncContentShops();

    expect(result.successCount).toBe(1);
    expect(result.failureCount).toBe(0);
    expect(result.totalCardsUpserted).toBe(2);
    expect(upsertedCards.map((card) => card.nmId)).toEqual([10, 11]);
    expect(upsertedCards[0]?.ageGroup).toBe("6+");
    expect(storedState).not.toBeNull();
    expect(storedState!.lastStatus).toBe("success");
    expect(storedState!.cursorNmId).toBe(11);
  });

  it("uses sandbox content endpoint and sandbox token when shop is configured for sandbox", async () => {
    testState.shops = {
      async listActiveShops() {
        return [
          {
            id: "shop-sandbox",
            name: "Sandbox Shop",
            wbToken: "prod-token",
            wbSandboxToken: "sandbox-token",
            useSandbox: true,
            isActive: true,
            supplyPrefix: "игрушки_",
            tokenUpdatedAt: new Date("2026-01-01T00:00:00.000Z"),
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            updatedAt: new Date("2026-01-01T00:00:00.000Z")
          } satisfies Shop
        ];
      }
    };

    testState.productCards = {
      async upsertMany(cards) {
        return cards.length;
      },
      async getByShopIdAndNmIds() {
        return [];
      }
    };

    testState.syncState = {
      async getByShopId() {
        return null;
      },
      async upsert() {
        return;
      }
    };

    testState.createClient = ({ token, baseUrl }) => {
      expect(token).toBe("sandbox-token");
      expect(baseUrl).toBe("https://content-api-sandbox.wildberries.ru");

      return {
        async POST() {
          return {
            data: {
              cards: [],
              cursor: {
                updatedAt: "2026-01-03T00:00:00.000Z",
                nmID: 1,
                total: 0
              }
            },
            response: new Response(null, { status: 200 })
          };
        }
      };
    };

    const service = createSyncContentShopsService({
      tenantId: "tenant-1",
      pageLimit: 2,
      maxPagesPerShop: 10
    });

    const result = await service.syncContentShops();

    expect(result.successCount).toBe(1);
    expect(result.failureCount).toBe(0);
  });

  it("always performs full sync from the first page and applies delay between pages", async () => {
    testState.shops = {
      async listActiveShops() {
        return [
          {
            id: "shop-full",
            name: "Full Sync Shop",
            wbToken: "token-full",
            wbSandboxToken: null,
            useSandbox: false,
            isActive: true,
            supplyPrefix: "игрушки_",
            tokenUpdatedAt: new Date("2026-01-01T00:00:00.000Z"),
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            updatedAt: new Date("2026-01-01T00:00:00.000Z")
          } satisfies Shop
        ];
      }
    };

    testState.productCards = {
      async upsertMany(cards) {
        return cards.length;
      },
      async getByShopIdAndNmIds() {
        return [];
      }
    };

    let storedState: SyncState | null = {
      shopId: "shop-full",
      cursorUpdatedAt: new Date("2030-01-01T00:00:00.000Z"),
      cursorNmId: 999999,
      lastSyncedAt: new Date("2030-01-01T00:00:00.000Z"),
      lastStatus: "success",
      lastError: null,
      updatedAt: new Date("2030-01-01T00:00:00.000Z")
    };

    testState.syncState = {
      async getByShopId() {
        return storedState;
      },
      async upsert(input: UpsertSyncStateInput) {
        storedState = {
          ...input
        };
      }
    };

    const sleepCalls: number[] = [];
    let call = 0;

    testState.createClient = () => ({
      async POST(_path, { body }) {
        call += 1;

        if (call === 1) {
          expect(body.settings?.cursor?.updatedAt).toBeUndefined();
          expect(body.settings?.cursor?.nmID).toBeUndefined();

          return {
            data: {
              cards: [
                {
                  nmID: 20,
                  title: "Title 20",
                  updatedAt: "2026-01-02T00:00:00.000Z"
                }
              ],
              cursor: {
                updatedAt: "2026-01-02T00:00:00.000Z",
                nmID: 20,
                total: 2
              }
            },
            response: new Response(null, { status: 200 })
          };
        }

        expect(body.settings?.cursor?.updatedAt).toBe("2026-01-02T00:00:00.000Z");
        expect(body.settings?.cursor?.nmID).toBe(20);

        return {
          data: {
            cards: [
              {
                nmID: 21,
                title: "Title 21",
                updatedAt: "2026-01-03T00:00:00.000Z"
              }
            ],
            cursor: {
              updatedAt: "2026-01-03T00:00:00.000Z",
              nmID: 21,
              total: 1
            }
          },
          response: new Response(null, { status: 200 })
        };
      }
    });

    const service = createSyncContentShopsService({
      tenantId: "tenant-1",
      pageLimit: 2,
      maxPagesPerShop: 10,
      betweenPagesDelayMs: 777,
      sleep: async (ms) => {
        sleepCalls.push(ms);
      }
    });

    const result = await service.syncContentShops();

    expect(result.successCount).toBe(1);
    expect(call).toBe(2);
    expect(sleepCalls).toEqual([777]);
    expect(storedState?.lastStatus).toBe("success");
    expect(storedState?.cursorNmId).toBe(21);
  });

  it("fails a shop when full sync reaches max pages limit", async () => {
    testState.shops = {
      async listActiveShops() {
        return [
          {
            id: "shop-limit",
            name: "Limit Shop",
            wbToken: "token-limit",
            wbSandboxToken: null,
            useSandbox: false,
            isActive: true,
            supplyPrefix: "игрушки_",
            tokenUpdatedAt: new Date("2026-01-01T00:00:00.000Z"),
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            updatedAt: new Date("2026-01-01T00:00:00.000Z")
          } satisfies Shop
        ];
      }
    };

    testState.productCards = {
      async upsertMany(cards) {
        return cards.length;
      },
      async getByShopIdAndNmIds() {
        return [];
      }
    };

    let storedState: SyncState | null = {
      shopId: "shop-limit",
      cursorUpdatedAt: new Date("2030-01-01T00:00:00.000Z"),
      cursorNmId: 777,
      lastSyncedAt: new Date("2030-01-01T00:00:00.000Z"),
      lastStatus: "success",
      lastError: null,
      updatedAt: new Date("2030-01-01T00:00:00.000Z")
    };

    testState.syncState = {
      async getByShopId() {
        return storedState;
      },
      async upsert(input: UpsertSyncStateInput) {
        storedState = {
          ...input
        };
      }
    };

    testState.createClient = () => ({
      async POST() {
        return {
          data: {
            cards: [{ nmID: 5001, title: "Card 5001" }],
            cursor: {
              updatedAt: "2026-01-02T00:00:00.000Z",
              nmID: 5001,
              total: 1
            }
          },
          response: new Response(null, { status: 200 })
        };
      }
    });

    const service = createSyncContentShopsService({
      tenantId: "tenant-1",
      pageLimit: 1,
      maxPagesPerShop: 1,
      betweenPagesDelayMs: 0
    });

    const result = await service.syncContentShops();

    expect(result.processedShops).toBe(1);
    expect(result.successCount).toBe(0);
    expect(result.failureCount).toBe(1);
    expect(result.results[0]?.status).toBe("failed");
    expect(result.results[0]?.error).toBe(
      "Full content sync reached max pages limit (1) for shop shop-limit"
    );
    expect(storedState?.lastStatus).toBe("failed");
    expect(storedState?.cursorNmId).toBe(777);
    expect(storedState?.lastSyncedAt?.toISOString()).toBe("2030-01-01T00:00:00.000Z");
  });

  it("continues syncing other shops when one shop fails", async () => {
    testState.shops = {
      async listActiveShops() {
        return [
          {
            id: "shop-fail",
            name: "Fail Shop",
            wbToken: "token-fail",
            wbSandboxToken: null,
            useSandbox: false,
            isActive: true,
            supplyPrefix: "игрушки_",
            tokenUpdatedAt: new Date("2026-01-01T00:00:00.000Z"),
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            updatedAt: new Date("2026-01-01T00:00:00.000Z")
          } satisfies Shop,
          {
            id: "shop-ok",
            name: "OK Shop",
            wbToken: "token-ok",
            wbSandboxToken: null,
            useSandbox: false,
            isActive: true,
            supplyPrefix: "игрушки_",
            tokenUpdatedAt: new Date("2026-01-01T00:00:00.000Z"),
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            updatedAt: new Date("2026-01-01T00:00:00.000Z")
          } satisfies Shop
        ];
      }
    };

    testState.productCards = {
      async upsertMany(cards) {
        return cards.length;
      },
      async getByShopIdAndNmIds() {
        return [];
      }
    };

    const states = new Map<string, SyncState | null>([
      ["shop-fail", null],
      ["shop-ok", null]
    ]);

    testState.syncState = {
      async getByShopId(shopId: string) {
        return states.get(shopId) ?? null;
      },
      async upsert(input: UpsertSyncStateInput) {
        states.set(input.shopId, {
          ...input
        });
      }
    };

    testState.createClient = ({ token }) => {
      if (token === "token-fail") {
        return {
          async POST() {
            throw new Error("products api down");
          }
        };
      }

      return {
        async POST() {
          return {
            data: {
              cards: [],
              cursor: {
                updatedAt: "2026-01-03T00:00:00.000Z",
                nmID: 1,
                total: 0
              }
            },
            response: new Response(null, { status: 200 })
          };
        }
      };
    };

    const service = createSyncContentShopsService({
      tenantId: "tenant-1",
      pageLimit: 100,
      maxPagesPerShop: 10,
      betweenPagesDelayMs: 0
    });

    const result = await service.syncContentShops();

    expect(result.processedShops).toBe(2);
    expect(result.successCount).toBe(1);
    expect(result.failureCount).toBe(1);
    expect(result.results.find((item) => item.shopId === "shop-fail")).toMatchObject({
      status: "failed",
      error: "products api down"
    });
    expect(result.results.find((item) => item.shopId === "shop-ok")).toMatchObject({
      status: "success",
      pagesFetched: 1,
      cardsUpserted: 0
    });
    expect(states.get("shop-fail")?.lastStatus).toBe("failed");
    expect(states.get("shop-ok")?.lastStatus).toBe("success");
  });

  it("caps shop sync concurrency at 10 and refills free slots immediately", async () => {
    const shopsList = Array.from({ length: 12 }, (_, index) => ({
      id: `shop-${index + 1}`,
      name: `Shop ${index + 1}`,
      wbToken: `token-${index + 1}`,
      wbSandboxToken: null,
      useSandbox: false,
      isActive: true,
      supplyPrefix: "игрушки_",
      tokenUpdatedAt: new Date("2026-01-01T00:00:00.000Z"),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z")
    })) satisfies Shop[];

    testState.shops = {
      async listActiveShops() {
        return shopsList;
      }
    };

    testState.productCards = {
      async upsertMany(cards) {
        return cards.length;
      },
      async getByShopIdAndNmIds() {
        return [];
      }
    };

    testState.syncState = {
      async getByShopId() {
        return null;
      },
      async upsert() {
        return;
      }
    };

    const deferredByToken = new Map<
      string,
      {
        resolve: () => void;
        promise: Promise<void>;
      }
    >();
    let inFlight = 0;
    let maxInFlight = 0;
    const startedTokens: string[] = [];

    for (const shop of shopsList) {
      let resolve = () => {};
      const promise = new Promise<void>((resolver) => {
        resolve = resolver;
      });
      deferredByToken.set(shop.wbToken, { resolve, promise });
    }

    testState.createClient = ({ token }) => ({
      async POST() {
        startedTokens.push(token);
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);

        const deferred = deferredByToken.get(token);
        if (!deferred) {
          throw new Error(`No deferred configured for token ${token}`);
        }
        await deferred.promise;
        inFlight -= 1;

        return {
          data: {
            cards: [],
            cursor: {
              updatedAt: "2026-01-03T00:00:00.000Z",
              nmID: 1,
              total: 0
            }
          },
          response: new Response(null, { status: 200 })
        };
      }
    });

    const service = createSyncContentShopsService({
      tenantId: "tenant-1",
      pageLimit: 100,
      maxPagesPerShop: 10,
      betweenPagesDelayMs: 0
    });

    const resultPromise = service.syncContentShops();
    await waitForCondition(() => startedTokens.length === 10);

    expect(startedTokens.length).toBe(10);
    expect(maxInFlight).toBe(10);

    deferredByToken.get("token-1")?.resolve();
    await waitForCondition(() => startedTokens.includes("token-11"));

    expect(startedTokens).toContain("token-11");
    expect(maxInFlight).toBe(10);

    for (const deferred of deferredByToken.values()) {
      deferred.resolve();
    }

    const result = await resultPromise;
    expect(result.processedShops).toBe(12);
    expect(result.successCount).toBe(12);
    expect(result.failureCount).toBe(0);
  });
});

async function waitForCondition(
  predicate: () => boolean,
  options: {
    maxTurns?: number;
    errorMessage?: string;
  } = {}
): Promise<void> {
  const maxTurns = options.maxTurns ?? 500;

  for (let turn = 0; turn < maxTurns; turn += 1) {
    if (predicate()) {
      return;
    }

    await Promise.resolve();
  }

  throw new Error(options.errorMessage ?? "Condition was not met in time");
}
