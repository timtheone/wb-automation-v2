import {
  createWbProductsClient,
  WB_PRODUCTS_API_BASE_URL,
  WB_PRODUCTS_SANDBOX_API_BASE_URL,
  type ProductsPaths
} from "@wb-automation-v2/wb-clients";
import {
  createDbRepositories,
  type ProductCard,
  type Shop
} from "@wb-automation-v2/db";

import { formatEmptyResponseMessage, toErrorMessage } from "./error-utils.js";

const DEFAULT_PAGE_LIMIT = 100;
const DEFAULT_MAX_PAGES_PER_SHOP = 500;

type GetCardsListOperation = ProductsPaths["/content/v2/get/cards/list"]["post"];
type CardsListBody = GetCardsListOperation["requestBody"]["content"]["application/json"];
type CardsListResponse = GetCardsListOperation["responses"][200]["content"]["application/json"];
type CardsListCard = NonNullable<CardsListResponse["cards"]>[number];

interface ApiResponse<TData> {
  data?: TData;
  response: Response;
}

export interface ProductsClient {
  POST(
    path: "/content/v2/get/cards/list",
    options: {
      body: CardsListBody;
    }
  ): Promise<ApiResponse<CardsListResponse>>;
}

export interface SyncContentShopsResultItem {
  shopId: string;
  shopName: string;
  pagesFetched: number;
  cardsUpserted: number;
  status: "success" | "failed";
  error: string | null;
}

export interface SyncContentShopsResult {
  startedAt: Date;
  finishedAt: Date;
  processedShops: number;
  successCount: number;
  failureCount: number;
  totalCardsUpserted: number;
  results: SyncContentShopsResultItem[];
}

type SyncContentShopsOptions = {
  now?: () => Date;
  pageLimit?: number;
  maxPagesPerShop?: number;
  onWbCardsListResponse?: (input: {
    shopId: string;
    shopName: string;
    page: number;
    apiBaseUrl: string;
    responseUrl: string;
    requestBody: CardsListBody;
    responseStatus: number;
    responseData: CardsListResponse;
  }) => void;
};

export interface SyncContentShopsService {
  syncContentShops(): Promise<SyncContentShopsResult>;
}

export function createSyncContentShopsService(
  options: SyncContentShopsOptions
): SyncContentShopsService {
  const now = options.now ?? (() => new Date());
  const pageLimit = options.pageLimit ?? DEFAULT_PAGE_LIMIT;
  const maxPagesPerShop = options.maxPagesPerShop ?? DEFAULT_MAX_PAGES_PER_SHOP;
  const onWbCardsListResponse = options.onWbCardsListResponse;
  const { shops, productCards, syncState } = createDbRepositories();

  return {
    async syncContentShops() {
      const startedAt = now();
      const activeShops = await shops.listActiveShops();
      const results: SyncContentShopsResultItem[] = [];
      let totalCardsUpserted = 0;

      for (const shop of activeShops) {
        const prevState = await syncState.getByShopId(shop.id);

        await syncState.upsert({
          shopId: shop.id,
          cursorUpdatedAt: prevState?.cursorUpdatedAt ?? null,
          cursorNmId: prevState?.cursorNmId ?? null,
          lastSyncedAt: prevState?.lastSyncedAt ?? null,
          lastStatus: "running",
          lastError: null,
          updatedAt: now()
        });

        let pagesFetched = 0;
        let cardsUpserted = 0;

        try {
          const credentials = resolveProductsCredentials(shop);
          const productsClient = createWbProductsClient(credentials);
          let cursorUpdatedAt = prevState?.cursorUpdatedAt ?? null;
          let cursorNmId = prevState?.cursorNmId ?? null;

          while (pagesFetched < maxPagesPerShop) {
            const body: CardsListBody = {
              settings: {
                sort: { ascending: true },
                filter: { withPhoto: -1 },
                cursor: {
                  limit: pageLimit,
                  ...(cursorUpdatedAt ? { updatedAt: cursorUpdatedAt.toISOString() } : {}),
                  ...(cursorNmId ? { nmID: cursorNmId } : {})
                }
              }
            };

            const result = await productsClient.POST("/content/v2/get/cards/list", { body });

            if (result.data === undefined) {
              throw new Error(formatEmptyResponseMessage(result.response));
            }

            onWbCardsListResponse?.({
              shopId: shop.id,
              shopName: shop.name,
              page: pagesFetched + 1,
              apiBaseUrl: credentials.baseUrl,
              responseUrl: result.response.url,
              requestBody: body,
              responseStatus: result.response.status,
              responseData: result.data
            });

            const cards = result.data.cards ?? [];
            const mappedCards = cards
              .map((card) => mapProductCard(shop.id, card, now()))
              .filter((card): card is ProductCard => card !== null);

            if (mappedCards.length > 0) {
              cardsUpserted += await productCards.upsertMany(mappedCards);
            }

            pagesFetched += 1;

            const nextCursorUpdatedAt = parseDateOrNull(result.data.cursor?.updatedAt);
            const nextCursorNmId = result.data.cursor?.nmID ?? null;
            const total = result.data.cursor?.total ?? cards.length;
            const cursorUnchanged =
              sameDate(nextCursorUpdatedAt, cursorUpdatedAt) && nextCursorNmId === cursorNmId;

            if (nextCursorUpdatedAt) {
              cursorUpdatedAt = nextCursorUpdatedAt;
            }

            if (typeof nextCursorNmId === "number") {
              cursorNmId = nextCursorNmId;
            }

            if (total < pageLimit || cursorUnchanged) {
              break;
            }
          }

          const finishedAt = now();

          await syncState.upsert({
            shopId: shop.id,
            cursorUpdatedAt,
            cursorNmId,
            lastSyncedAt: finishedAt,
            lastStatus: "success",
            lastError: null,
            updatedAt: finishedAt
          });

          totalCardsUpserted += cardsUpserted;
          results.push({
            shopId: shop.id,
            shopName: shop.name,
            pagesFetched,
            cardsUpserted,
            status: "success",
            error: null
          });
        } catch (error) {
          const errorMessage = toErrorMessage(error);

          await syncState.upsert({
            shopId: shop.id,
            cursorUpdatedAt: prevState?.cursorUpdatedAt ?? null,
            cursorNmId: prevState?.cursorNmId ?? null,
            lastSyncedAt: prevState?.lastSyncedAt ?? null,
            lastStatus: "failed",
            lastError: errorMessage,
            updatedAt: now()
          });

          results.push({
            shopId: shop.id,
            shopName: shop.name,
            pagesFetched,
            cardsUpserted,
            status: "failed",
            error: errorMessage
          });
        }
      }

      const successCount = results.filter((item) => item.status === "success").length;

      return {
        startedAt,
        finishedAt: now(),
        processedShops: results.length,
        successCount,
        failureCount: results.length - successCount,
        totalCardsUpserted,
        results
      };
    }
  };
}

function resolveProductsCredentials(shop: Shop): { token: string; baseUrl: string } {
  if (!shop.useSandbox) {
    return {
      token: shop.wbToken,
      baseUrl: WB_PRODUCTS_API_BASE_URL
    };
  }

  if (!shop.wbSandboxToken) {
    throw new Error(`Shop ${shop.id} is configured for sandbox but wbSandboxToken is empty`);
  }

  return {
    token: shop.wbSandboxToken,
    baseUrl: WB_PRODUCTS_SANDBOX_API_BASE_URL
  };
}

function mapProductCard(shopId: string, card: CardsListCard, syncedAt: Date): ProductCard | null {
  if (typeof card.nmID !== "number") {
    return null;
  }

  const photo = card.photos?.[0];

  return {
    shopId,
    nmId: card.nmID,
    vendorCode: card.vendorCode ?? null,
    brand: card.brand ?? null,
    title: card.title ?? null,
    img: photo?.big ?? photo?.square ?? photo?.tm ?? null,
    ageGroup: extractAgeGroup(card.characteristics),
    wbCreatedAt: parseDateOrNull(card.createdAt),
    wbUpdatedAt: parseDateOrNull(card.updatedAt),
    syncedAt
  };
}

function extractAgeGroup(
  characteristics: { name?: string; value?: unknown }[] | undefined
): string | null {
  if (!characteristics || characteristics.length === 0) {
    return null;
  }

  const ageCharacteristic = characteristics.find((item) => {
    const name = item.name?.toLowerCase();
    return Boolean(name && (name.includes("vozrast") || name.includes("age") || name.includes("возраст")));
  });

  if (!ageCharacteristic) {
    return null;
  }

  if (typeof ageCharacteristic.value === "string") {
    return ageCharacteristic.value;
  }

  if (Array.isArray(ageCharacteristic.value)) {
    const value = ageCharacteristic.value.find((item) => typeof item === "string");
    return typeof value === "string" ? value : null;
  }

  return null;
}

function parseDateOrNull(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function sameDate(a: Date | null, b: Date | null): boolean {
  if (a === null && b === null) {
    return true;
  }

  if (a === null || b === null) {
    return false;
  }

  return a.getTime() === b.getTime();
}
