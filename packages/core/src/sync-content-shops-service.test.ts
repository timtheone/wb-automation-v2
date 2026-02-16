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
    createClient: null as ((token: string) => ProductsClient) | null
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
    createWbProductsClient: ({ token }: { token: string }) => {
      if (!testState.createClient) {
        throw new Error("WB products client mock is not configured");
      }

      return testState.createClient(token);
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
    testState.createClient = (token: string): ProductsClient => {
      expect(token).toBe("token-1");

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
      pageLimit: 2,
      maxPagesPerShop: 10,
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
});
