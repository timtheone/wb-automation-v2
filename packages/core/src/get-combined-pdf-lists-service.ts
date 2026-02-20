import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createWbFbsClient,
  WB_FBS_SANDBOX_API_BASE_URL,
  type FbsPaths,
  type WbFbsClient
} from "@wb-automation-v2/wb-clients";
import { createDbRepositories, type Database, type ProductCard, type Shop } from "@wb-automation-v2/db";

import { formatEmptyResponseMessage, toErrorMessage } from "./error-utils.js";

const DEFAULT_SUPPLY_PAGE_LIMIT = 1_000;
const DEFAULT_MAX_SUPPLIES_PER_SHOP = 1;
const DEFAULT_WAITING_MAX_SUPPLIES_PER_SHOP = 6;
const DEFAULT_ORDERS_LOOKBACK_DAYS = 30;
const DEFAULT_MAX_EMBEDDED_IMAGES = 1_000;

const STICKER_MM_WIDTH = 58;
const STICKER_MM_HEIGHT = 40;
const PDF_FONT_REGULAR_PATH = resolveCoreAssetPath("fonts", "NotoSans-Regular.ttf");
const PDF_FONT_BOLD_PATH = resolveCoreAssetPath("fonts", "NotoSans-Bold.ttf");
const ORDER_LIST_TITLE = "Листы подбора:";
const WAITING_ORDER_LIST_TITLE_SUFFIX = "(ожидающие)";
const ORDER_LIST_TEXT_FONT_SIZE = 12;
const ORDER_LIST_TABLE_FONT_SIZE = 9;
const ORDER_LIST_ORDER_ID_FONT_SIZE = 8;
const ORDER_LIST_IMAGE_MAX_WIDTH_PX = 180;
const ORDER_LIST_IMAGE_MAX_HEIGHT_PX = 220;
const ORDER_LIST_IMAGE_JPEG_QUALITY = 62;
const IMAGE_FETCH_RETRIES = 2;
const require = createRequire(import.meta.url);

type SharpLike = (input: Buffer) => {
  rotate: () => {
    resize: (options: { width?: number; height?: number; fit?: "inside"; withoutEnlargement?: boolean }) => {
      jpeg: (options: {
        quality: number;
        mozjpeg: boolean;
        progressive: boolean;
        chromaSubsampling: "4:2:0";
      }) => {
        toBuffer: () => Promise<Buffer>;
      };
    };
  };
  jpeg: (options: {
    quality: number;
    mozjpeg: boolean;
    progressive: boolean;
    chromaSubsampling: "4:2:0";
  }) => {
    toBuffer: () => Promise<Buffer>;
  };
};

let cachedSharp: SharpLike | null | undefined;

type SuppliesListResponse = FbsPaths["/api/v3/supplies"]["get"]["responses"][200]["content"]["application/json"];
type SupplyOrderIdsResponse =
  FbsPaths["/api/marketplace/v3/supplies/{supplyId}/order-ids"]["get"]["responses"][200]["content"]["application/json"];
type OrdersListResponse = FbsPaths["/api/v3/orders"]["get"]["responses"][200]["content"]["application/json"];
type OrderStickerResponse =
  FbsPaths["/api/v3/orders/stickers"]["post"]["responses"][200]["content"]["application/json"];
type OrderStatusesResponse = FbsPaths["/api/v3/orders/status"]["post"]["responses"][200]["content"]["application/json"];

type CombinedPdfFlowMode = "latest" | "waiting";

interface CombinedRow {
  shopId: string;
  shopName: string;
  supplyId: string;
  orderId: number;
  orderCreatedAt: Date | null;
  nmId: number | null;
  brand: string | null;
  title: string | null;
  ageGroup: string | null;
  img: string | null;
  stickerPartA: string | null;
  stickerPartB: string | null;
  stickerFileBase64: string | null;
}

interface SupplySelection {
  supplyId: string;
  orderIds: number[];
}

interface OrderFacts {
  nmId: number | null;
  createdAt: Date | null;
}

interface StickerFacts {
  partA: string | null;
  partB: string | null;
  file: string | null;
}

interface ImageFetchResult {
  contentType: string | null;
  body: Uint8Array;
}

type GetCombinedPdfListsWbDebugEvent =
  | {
      step: "supplies_page";
      shopId: string;
      shopName: string;
      requestNext: number;
      responseStatus: number;
      responseUrl: string;
      suppliesCount: number;
      nextCursor: number | null;
      matchedSupplyIds: string[];
    }
  | {
      step: "supply_order_ids";
      shopId: string;
      shopName: string;
      supplyId: string;
      responseStatus: number;
      responseUrl: string;
      orderIdsCount: number;
      sampleOrderIds: number[];
    }
  | {
      step: "orders_page";
      shopId: string;
      shopName: string;
      requestNext: number;
      dateFromUnix: number;
      responseStatus: number;
      responseUrl: string;
      ordersCount: number;
      nextCursor: number | null;
      sampleOrders: Array<{ id: number | null; nmId: number | null; supplyId: string | null }>;
    }
  | {
      step: "stickers_batch";
      shopId: string;
      shopName: string;
      batchSize: number;
      responseStatus: number;
      responseUrl: string;
      stickersCount: number;
      sampleStickers: Array<{ orderId: number | null; partA: string | null; partB: string | null; hasFile: boolean }>;
    }
  | {
      step: "order_status_batch";
      shopId: string;
      shopName: string;
      batchSize: number;
      responseStatus: number;
      responseUrl: string;
      statusesCount: number;
      waitingCount: number;
    }
  | {
      step: "shop_summary";
      shopId: string;
      shopName: string;
      selectedSupplyIds: string[];
      uniqueOrderIdsCount: number;
      knownOrdersWithNmIdCount: number;
      stickersResolvedCount: number;
      productCardsResolvedCount: number;
      missingProductCards: number;
    }
  | {
      step: "pagination_guard";
      shopId: string;
      shopName: string;
      phase: "supplies" | "orders";
      reason: "cursor_repeated" | "short_page";
      requestNext: number;
      nextCursor: number | null;
      itemsCount: number;
    };

export interface GetCombinedPdfListsResultItem {
  shopId: string;
  shopName: string;
  status: "success" | "skipped" | "failed";
  supplyIds: string[];
  orderIds: number[];
  ordersCollected: number;
  missingProductCards: number;
  error: string | null;
}

export interface GetCombinedPdfListsResult {
  startedAt: Date;
  finishedAt: Date;
  processedShops: number;
  successCount: number;
  skippedCount: number;
  failureCount: number;
  totalOrdersCollected: number;
  orderListFileName: string;
  stickersFileName: string;
  orderListPdfBase64: string;
  stickersPdfBase64: string;
  results: GetCombinedPdfListsResultItem[];
}

type GetCombinedPdfListsOptions = {
  tenantId: string;
  db: Database;
  mode?: CombinedPdfFlowMode;
  now?: () => Date;
  supplyPageLimit?: number;
  maxSuppliesPerShop?: number;
  ordersLookbackDays?: number;
  maxEmbeddedImages?: number;
  fetchImage?: (url: string) => Promise<ImageFetchResult>;
  onWbApiDebug?: (event: GetCombinedPdfListsWbDebugEvent) => void;
};

export interface GetCombinedPdfListsService {
  getCombinedPdfLists(): Promise<GetCombinedPdfListsResult>;
}

export interface GetWaitingOrdersPdfListsService {
  getWaitingOrdersPdfLists(): Promise<GetCombinedPdfListsResult>;
}

export function createGetWaitingOrdersPdfListsService(
  options: Omit<GetCombinedPdfListsOptions, "mode">
): GetWaitingOrdersPdfListsService {
  const service = createGetCombinedPdfListsService({
    ...options,
    mode: "waiting"
  });

  return {
    async getWaitingOrdersPdfLists() {
      return service.getCombinedPdfLists();
    }
  };
}

export function createGetCombinedPdfListsService(
  options: GetCombinedPdfListsOptions
): GetCombinedPdfListsService {
  const mode = options.mode ?? "latest";
  const now = options.now ?? (() => new Date());
  const supplyPageLimit = options.supplyPageLimit ?? DEFAULT_SUPPLY_PAGE_LIMIT;
  const maxSuppliesPerShop =
    options.maxSuppliesPerShop ??
    (mode === "waiting" ? DEFAULT_WAITING_MAX_SUPPLIES_PER_SHOP : DEFAULT_MAX_SUPPLIES_PER_SHOP);
  const ordersLookbackDays = options.ordersLookbackDays ?? DEFAULT_ORDERS_LOOKBACK_DAYS;
  const maxEmbeddedImages = options.maxEmbeddedImages ?? DEFAULT_MAX_EMBEDDED_IMAGES;
  const fetchImage = options.fetchImage ?? defaultFetchImage;
  const onWbApiDebug = options.onWbApiDebug;
  const emitWbApiDebug = (event: GetCombinedPdfListsWbDebugEvent) => {
    onWbApiDebug?.(event);
  };
  const { shops, productCards } = createDbRepositories({
    tenantId: options.tenantId,
    db: options.db
  });

  return {
    async getCombinedPdfLists() {
      const startedAt = now();
      const activeShops = await shops.listActiveShops();
      const rows: CombinedRow[] = [];
      const results: GetCombinedPdfListsResultItem[] = [];

      for (const shop of activeShops) {
        try {
          const credentials = resolveFbsCredentials(shop);
          const fbsClient = createWbFbsClient(credentials);
          const selectedSupplies = await getLatestDoneSuppliesWithOrders({
            fbsClient,
            shopId: shop.id,
            shopName: shop.name,
            supplyPrefix: shop.supplyPrefix,
            supplyPageLimit,
            maxSuppliesPerShop,
            skipNewestSupply: mode === "waiting",
            emitWbApiDebug
          });

          const suppliesForRows =
            mode === "waiting"
              ? await filterSuppliesByWaitingOrderStatus({
                  fbsClient,
                  shopId: shop.id,
                  shopName: shop.name,
                  supplies: selectedSupplies,
                  emitWbApiDebug
                })
              : selectedSupplies;

          const uniqueOrderIds = uniqueSorted(
            suppliesForRows.flatMap((supply) => supply.orderIds)
          );

          if (suppliesForRows.length === 0 || uniqueOrderIds.length === 0) {
            results.push({
              shopId: shop.id,
              shopName: shop.name,
              status: "skipped",
              supplyIds: suppliesForRows.map((supply) => supply.supplyId),
              orderIds: uniqueOrderIds,
              ordersCollected: 0,
              missingProductCards: 0,
              error: null
            });
            continue;
          }

          const orderFactsById = await getOrderFactsById({
            fbsClient,
            shopId: shop.id,
            shopName: shop.name,
            lookbackDays: ordersLookbackDays,
            emitWbApiDebug
          });

          const stickersByOrderId = await getStickersByOrderId({
            fbsClient,
            shopId: shop.id,
            shopName: shop.name,
            orderIds: uniqueOrderIds,
            emitWbApiDebug
          });

          const nmIds = uniqueSorted(
            uniqueOrderIds
              .map((orderId) => orderFactsById.get(orderId)?.nmId ?? null)
              .filter((nmId): nmId is number => typeof nmId === "number")
          );
          const cardsByNmId = await getCardsByNmId({
            shopId: shop.id,
            nmIds,
            productCards
          });

          let missingProductCards = 0;

          for (const supply of suppliesForRows) {
            for (const orderId of supply.orderIds) {
              const orderFacts = orderFactsById.get(orderId);
              const nmId = orderFacts?.nmId ?? null;
              const card = nmId === null ? null : cardsByNmId.get(nmId) ?? null;

              if (card === null) {
                missingProductCards += 1;
              }

              const sticker = stickersByOrderId.get(orderId);

              rows.push({
                shopId: shop.id,
                shopName: shop.name,
                supplyId: supply.supplyId,
                orderId,
                orderCreatedAt: orderFacts?.createdAt ?? null,
                nmId,
                brand: card?.brand ?? null,
                title: card?.title ?? null,
                ageGroup: card?.ageGroup ?? null,
                img: card?.img ?? null,
                stickerPartA: sticker?.partA ?? null,
                stickerPartB: sticker?.partB ?? null,
                stickerFileBase64: sticker?.file ?? null
              });
            }
          }

          results.push({
            shopId: shop.id,
            shopName: shop.name,
            status: "success",
            supplyIds: suppliesForRows.map((supply) => supply.supplyId),
            orderIds: uniqueOrderIds,
            ordersCollected: uniqueOrderIds.length,
            missingProductCards,
            error: null
          });

          emitWbApiDebug({
            step: "shop_summary",
            shopId: shop.id,
            shopName: shop.name,
            selectedSupplyIds: suppliesForRows.map((supply) => supply.supplyId),
            uniqueOrderIdsCount: uniqueOrderIds.length,
            knownOrdersWithNmIdCount: nmIds.length,
            stickersResolvedCount: stickersByOrderId.size,
            productCardsResolvedCount: cardsByNmId.size,
            missingProductCards
          });
        } catch (error) {
          results.push({
            shopId: shop.id,
            shopName: shop.name,
            status: "failed",
            supplyIds: [],
            orderIds: [],
            ordersCollected: 0,
            missingProductCards: 0,
            error: toErrorMessage(error)
          });
        }
      }

      const sortedRows = rows.toSorted((left, right) => compareRows(left, right));
      const imageByUrl = await preloadImages(sortedRows, fetchImage, maxEmbeddedImages);
      const orderListPdfBuffer = await renderOrderListPdf(sortedRows, imageByUrl, mode);
      const stickersPdfBuffer = await renderStickersPdf(sortedRows);
      const finishedAt = now();
      const successCount = results.filter((item) => item.status === "success").length;
      const skippedCount = results.filter((item) => item.status === "skipped").length;

      return {
        startedAt,
        finishedAt,
        processedShops: results.length,
        successCount,
        skippedCount,
        failureCount: results.length - successCount - skippedCount,
        totalOrdersCollected: rows.length,
        orderListFileName:
          mode === "waiting"
            ? `Лист-подбора-ожидающие_${formatRuFileDate(finishedAt)}.pdf`
            : `Лист-подбора_${formatRuFileDate(finishedAt)}.pdf`,
        stickersFileName:
          mode === "waiting"
            ? `Стикеры-ожидающие_${formatRuFileDate(finishedAt)}.pdf`
            : `Стикеры_${formatRuFileDate(finishedAt)}.pdf`,
        orderListPdfBase64: orderListPdfBuffer.toString("base64"),
        stickersPdfBase64: stickersPdfBuffer.toString("base64"),
        results
      };
    }
  };
}

async function getLatestDoneSuppliesWithOrders(input: {
  fbsClient: WbFbsClient;
  shopId: string;
  shopName: string;
  supplyPrefix: string;
  supplyPageLimit: number;
  maxSuppliesPerShop: number;
  skipNewestSupply: boolean;
  emitWbApiDebug: (event: GetCombinedPdfListsWbDebugEvent) => void;
}): Promise<SupplySelection[]> {
  const matchingSupplies: Array<{ id: string; closedAt: Date | null; createdAt: Date | null }> = [];
  let next = 0;
  const seenRequestCursors = new Set<number>();

  while (true) {
    if (seenRequestCursors.has(next)) {
      input.emitWbApiDebug({
        step: "pagination_guard",
        shopId: input.shopId,
        shopName: input.shopName,
        phase: "supplies",
        reason: "cursor_repeated",
        requestNext: next,
        nextCursor: next,
        itemsCount: 0
      });
      break;
    }

    seenRequestCursors.add(next);

    const requestNext = next;

    const suppliesResult = await input.fbsClient.GET("/api/v3/supplies", {
      params: {
        query: {
          limit: input.supplyPageLimit,
          next: requestNext
        }
      }
    });

    if (suppliesResult.data === undefined) {
      throw new Error(formatEmptyResponseMessage(suppliesResult.response));
    }

    const matchedSupplyIds = (suppliesResult.data.supplies ?? [])
      .filter(
        (supply) =>
          supply.done === true &&
          typeof supply.id === "string" &&
          typeof supply.name === "string" &&
          supply.name.startsWith(input.supplyPrefix)
      )
      .map((supply) => supply.id as string);

    input.emitWbApiDebug({
      step: "supplies_page",
      shopId: input.shopId,
      shopName: input.shopName,
      requestNext,
      responseStatus: suppliesResult.response.status,
      responseUrl: suppliesResult.response.url,
      suppliesCount: (suppliesResult.data.supplies ?? []).length,
      nextCursor: typeof suppliesResult.data.next === "number" ? suppliesResult.data.next : null,
      matchedSupplyIds
    });

    collectMatchingDoneSupplies(matchingSupplies, suppliesResult.data, input.supplyPrefix);

    const itemsCount = (suppliesResult.data.supplies ?? []).length;
    const nextCursor = typeof suppliesResult.data.next === "number" ? suppliesResult.data.next : null;

    if (itemsCount < input.supplyPageLimit) {
      input.emitWbApiDebug({
        step: "pagination_guard",
        shopId: input.shopId,
        shopName: input.shopName,
        phase: "supplies",
        reason: "short_page",
        requestNext,
        nextCursor,
        itemsCount
      });
      break;
    }

    if (nextCursor === null || nextCursor <= 0) {
      break;
    }

    if (nextCursor === requestNext) {
      input.emitWbApiDebug({
        step: "pagination_guard",
        shopId: input.shopId,
        shopName: input.shopName,
        phase: "supplies",
        reason: "cursor_repeated",
        requestNext,
        nextCursor,
        itemsCount
      });
      break;
    }

    next = nextCursor;
  }

  const sortedSupplyIds = matchingSupplies
    .toSorted(compareSuppliesByRecency)
    .map((supply) => supply.id)
    .filter((id, index, values) => values.indexOf(id) === index);

  const selectedSupplyIds = input.skipNewestSupply
    ? sortedSupplyIds.slice(1, input.maxSuppliesPerShop + 1)
    : sortedSupplyIds.slice(0, input.maxSuppliesPerShop);

  const selections: SupplySelection[] = [];

  for (const supplyId of selectedSupplyIds) {
    const orderIdsResult = await input.fbsClient.GET("/api/marketplace/v3/supplies/{supplyId}/order-ids", {
      params: {
        path: { supplyId }
      }
    });

    if (orderIdsResult.data === undefined) {
      throw new Error(formatEmptyResponseMessage(orderIdsResult.response));
    }

    const normalizedOrderIds = normalizeOrderIds(orderIdsResult.data);

    input.emitWbApiDebug({
      step: "supply_order_ids",
      shopId: input.shopId,
      shopName: input.shopName,
      supplyId,
      responseStatus: orderIdsResult.response.status,
      responseUrl: orderIdsResult.response.url,
      orderIdsCount: normalizedOrderIds.length,
      sampleOrderIds: normalizedOrderIds.slice(0, 10)
    });

    selections.push({
      supplyId,
      orderIds: normalizedOrderIds
    });
  }

  return selections;
}

async function getOrderFactsById(input: {
  fbsClient: WbFbsClient;
  shopId: string;
  shopName: string;
  lookbackDays: number;
  emitWbApiDebug: (event: GetCombinedPdfListsWbDebugEvent) => void;
}): Promise<Map<number, OrderFacts>> {
  const orderFactsById = new Map<number, OrderFacts>();
  const dateFrom = Math.floor(Date.now() / 1_000) - input.lookbackDays * 24 * 60 * 60;
  let next = 0;
  const seenRequestCursors = new Set<number>();

  while (true) {
    if (seenRequestCursors.has(next)) {
      input.emitWbApiDebug({
        step: "pagination_guard",
        shopId: input.shopId,
        shopName: input.shopName,
        phase: "orders",
        reason: "cursor_repeated",
        requestNext: next,
        nextCursor: next,
        itemsCount: 0
      });
      break;
    }

    seenRequestCursors.add(next);

    const requestNext = next;

    const response = await input.fbsClient.GET("/api/v3/orders", {
      params: {
        query: {
          limit: 1_000,
          next: requestNext,
          dateFrom
        }
      }
    });

    if (response.data === undefined) {
      throw new Error(formatEmptyResponseMessage(response.response));
    }

    input.emitWbApiDebug({
      step: "orders_page",
      shopId: input.shopId,
      shopName: input.shopName,
      requestNext,
      dateFromUnix: dateFrom,
      responseStatus: response.response.status,
      responseUrl: response.response.url,
      ordersCount: (response.data.orders ?? []).length,
      nextCursor: typeof response.data.next === "number" ? response.data.next : null,
      sampleOrders: (response.data.orders ?? []).slice(0, 5).map((order) => ({
        id: normalizeInteger(order.id),
        nmId: normalizeInteger(order.nmId),
        supplyId: typeof order.supplyId === "string" ? order.supplyId : null
      }))
    });

    collectOrderFacts(orderFactsById, response.data);

    const itemsCount = (response.data.orders ?? []).length;
    const nextCursor = typeof response.data.next === "number" ? response.data.next : null;

    if (itemsCount < 1_000) {
      input.emitWbApiDebug({
        step: "pagination_guard",
        shopId: input.shopId,
        shopName: input.shopName,
        phase: "orders",
        reason: "short_page",
        requestNext,
        nextCursor,
        itemsCount
      });
      break;
    }

    if (nextCursor === null || nextCursor <= 0) {
      break;
    }

    if (nextCursor === requestNext) {
      input.emitWbApiDebug({
        step: "pagination_guard",
        shopId: input.shopId,
        shopName: input.shopName,
        phase: "orders",
        reason: "cursor_repeated",
        requestNext,
        nextCursor,
        itemsCount
      });
      break;
    }

    next = nextCursor;
  }

  return orderFactsById;
}

async function getStickersByOrderId(input: {
  fbsClient: WbFbsClient;
  shopId: string;
  shopName: string;
  orderIds: number[];
  emitWbApiDebug: (event: GetCombinedPdfListsWbDebugEvent) => void;
}): Promise<Map<number, StickerFacts>> {
  const byOrderId = new Map<number, StickerFacts>();

  for (const batch of toBatches(input.orderIds, 100)) {
    const response = await input.fbsClient.POST("/api/v3/orders/stickers", {
      params: {
        query: {
          type: "png",
          width: 58,
          height: 40
        }
      },
      body: {
        orders: batch
      }
    });

    if (response.data === undefined) {
      throw new Error(formatEmptyResponseMessage(response.response));
    }

    input.emitWbApiDebug({
      step: "stickers_batch",
      shopId: input.shopId,
      shopName: input.shopName,
      batchSize: batch.length,
      responseStatus: response.response.status,
      responseUrl: response.response.url,
      stickersCount: (response.data.stickers ?? []).length,
      sampleStickers: (response.data.stickers ?? []).slice(0, 5).map((sticker) => ({
        orderId: normalizeInteger(sticker.orderId),
        partA: normalizeStickerPart(sticker.partA),
        partB: normalizeStickerPart(sticker.partB),
        hasFile: typeof sticker.file === "string" && sticker.file.length > 0
      }))
    });

    collectStickerFacts(byOrderId, response.data);
  }

  return byOrderId;
}

async function filterSuppliesByWaitingOrderStatus(input: {
  fbsClient: WbFbsClient;
  shopId: string;
  shopName: string;
  supplies: SupplySelection[];
  emitWbApiDebug: (event: GetCombinedPdfListsWbDebugEvent) => void;
}): Promise<SupplySelection[]> {
  const uniqueOrderIds = uniqueSorted(input.supplies.flatMap((supply) => supply.orderIds));

  if (uniqueOrderIds.length === 0) {
    return [];
  }

  const statusByOrderId = await getOrderStatusesByOrderId({
    fbsClient: input.fbsClient,
    shopId: input.shopId,
    shopName: input.shopName,
    orderIds: uniqueOrderIds,
    emitWbApiDebug: input.emitWbApiDebug
  });

  return input.supplies
    .map((supply) => ({
      supplyId: supply.supplyId,
      orderIds: supply.orderIds.filter((orderId) => statusByOrderId.get(orderId) === "waiting")
    }))
    .filter((supply) => supply.orderIds.length > 0);
}

async function getOrderStatusesByOrderId(input: {
  fbsClient: WbFbsClient;
  shopId: string;
  shopName: string;
  orderIds: number[];
  emitWbApiDebug: (event: GetCombinedPdfListsWbDebugEvent) => void;
}): Promise<Map<number, string>> {
  const byOrderId = new Map<number, string>();

  for (const batch of toBatches(input.orderIds, 1_000)) {
    const response = await input.fbsClient.POST("/api/v3/orders/status", {
      body: {
        orders: batch
      }
    });

    if (response.data === undefined) {
      throw new Error(formatEmptyResponseMessage(response.response));
    }

    collectOrderStatuses(byOrderId, response.data);

    input.emitWbApiDebug({
      step: "order_status_batch",
      shopId: input.shopId,
      shopName: input.shopName,
      batchSize: batch.length,
      responseStatus: response.response.status,
      responseUrl: response.response.url,
      statusesCount: (response.data.orders ?? []).length,
      waitingCount: (response.data.orders ?? []).filter((order) => order.wbStatus === "waiting").length
    });
  }

  return byOrderId;
}

async function getCardsByNmId(input: {
  shopId: string;
  nmIds: number[];
  productCards: {
    getByShopIdAndNmIds(shopId: string, nmIds: number[]): Promise<ProductCard[]>;
  };
}): Promise<Map<number, ProductCard>> {
  if (input.nmIds.length === 0) {
    return new Map();
  }

  const cards = await input.productCards.getByShopIdAndNmIds(input.shopId, input.nmIds);
  return new Map(cards.map((card) => [card.nmId, card]));
}

function collectMatchingDoneSupplies(
  destination: Array<{ id: string; closedAt: Date | null; createdAt: Date | null }>,
  response: SuppliesListResponse,
  supplyPrefix: string
): void {
  for (const supply of response.supplies ?? []) {
    if (
      supply.done === true &&
      typeof supply.id === "string" &&
      typeof supply.name === "string" &&
      supply.name.startsWith(supplyPrefix)
    ) {
      destination.push({
        id: supply.id,
        closedAt: parseDateOrNull(supply.closedAt),
        createdAt: parseDateOrNull(supply.createdAt)
      });
    }
  }
}

function collectOrderFacts(destination: Map<number, OrderFacts>, response: OrdersListResponse): void {
  for (const order of response.orders ?? []) {
    const orderId = normalizeInteger(order.id);

    if (orderId === null) {
      continue;
    }

    destination.set(orderId, {
      nmId: normalizeInteger(order.nmId),
      createdAt: parseDateOrNull(order.createdAt)
    });
  }
}

function collectStickerFacts(destination: Map<number, StickerFacts>, response: OrderStickerResponse): void {
  for (const sticker of response.stickers ?? []) {
    const orderId = normalizeInteger(sticker.orderId);

    if (orderId === null) {
      continue;
    }

    destination.set(orderId, {
      partA: normalizeStickerPart(sticker.partA),
      partB: normalizeStickerPart(sticker.partB),
      file: typeof sticker.file === "string" ? sticker.file : null
    });
  }
}

function collectOrderStatuses(destination: Map<number, string>, response: OrderStatusesResponse): void {
  for (const order of response.orders ?? []) {
    const orderId = normalizeInteger(order.id);

    if (orderId === null || typeof order.wbStatus !== "string") {
      continue;
    }

    destination.set(orderId, order.wbStatus);
  }
}

function normalizeOrderIds(response: SupplyOrderIdsResponse): number[] {
  return uniqueSorted((response.orderIds ?? []).map(normalizeInteger).filter((orderId): orderId is number => orderId !== null));
}

function normalizeInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (!/^\d+$/.test(trimmed)) {
      return null;
    }

    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeStickerPart(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }

  return null;
}

function compareSuppliesByRecency(
  left: { closedAt: Date | null; createdAt: Date | null },
  right: { closedAt: Date | null; createdAt: Date | null }
): number {
  const leftValue = (left.closedAt ?? left.createdAt)?.getTime() ?? 0;
  const rightValue = (right.closedAt ?? right.createdAt)?.getTime() ?? 0;
  return rightValue - leftValue;
}

function compareRows(left: CombinedRow, right: CombinedRow): number {
  if (left.title && right.title) {
    const byTitle = left.title.localeCompare(right.title, "ru");
    if (byTitle !== 0) {
      return byTitle;
    }
  } else if (left.title && !right.title) {
    return -1;
  } else if (!left.title && right.title) {
    return 1;
  }

  return left.orderId - right.orderId;
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function toBatches(values: number[], size: number): number[][] {
  const result: number[][] = [];

  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }

  return result;
}

async function preloadImages(
  rows: CombinedRow[],
  fetchImage: (url: string) => Promise<ImageFetchResult>,
  maxEmbeddedImages: number
): Promise<Map<string, Uint8Array>> {
  const uniqueUrls = [...new Set(rows.map((row) => row.img).filter((value): value is string => Boolean(value)))];
  const selectedUrls = uniqueUrls.slice(0, maxEmbeddedImages);
  const imageByUrl = new Map<string, Uint8Array>();

  for (const url of selectedUrls) {
    const candidates = buildImageUrlCandidates(url);

    for (const candidateUrl of candidates) {
      for (let attempt = 0; attempt < IMAGE_FETCH_RETRIES; attempt += 1) {
        try {
          const result = await fetchImage(candidateUrl);
          const normalizedBody = await normalizeImageForPdf({
            url: candidateUrl,
            contentType: result.contentType,
            body: result.body
          });

          if (normalizedBody !== null) {
            imageByUrl.set(url, normalizedBody);
            break;
          }
        } catch {
          continue;
        }
      }

      if (imageByUrl.has(url)) {
        break;
      }
    }
  }

  return imageByUrl;
}

function buildImageUrlCandidates(url: string): string[] {
  const candidates = [url];

  if (url.includes("/images/big/")) {
    candidates.push(url.replace("/images/big/", "/images/c246x328/"));
    candidates.push(url.replace("/images/big/", "/images/square/"));
    candidates.push(url.replace("/images/big/", "/images/tm/"));
  }

  return [...new Set(candidates)];
}

async function normalizeImageForPdf(input: {
  url: string;
  contentType: string | null;
  body: Uint8Array;
}): Promise<Uint8Array | null> {
  const contentType = input.contentType?.toLowerCase() ?? "";
  const lowerUrl = input.url.toLowerCase();
  const isPngOrJpeg =
    contentType.includes("image/png") ||
    contentType.includes("image/jpeg") ||
    contentType.includes("image/jpg") ||
    lowerUrl.endsWith(".png") ||
    lowerUrl.endsWith(".jpg") ||
    lowerUrl.endsWith(".jpeg");
  const isWebp = contentType.includes("image/webp") || lowerUrl.endsWith(".webp");

  if (!isPngOrJpeg && !isWebp) {
    return null;
  }

  const sharp = loadSharp();

  if (!sharp) {
    return isPngOrJpeg ? input.body : null;
  }

  try {
    const converted = await sharp(Buffer.from(input.body))
      .rotate()
      .resize({
        width: ORDER_LIST_IMAGE_MAX_WIDTH_PX,
        height: ORDER_LIST_IMAGE_MAX_HEIGHT_PX,
        fit: "inside",
        withoutEnlargement: true
      })
      .jpeg({
        quality: ORDER_LIST_IMAGE_JPEG_QUALITY,
        mozjpeg: true,
        progressive: true,
        chromaSubsampling: "4:2:0"
      })
      .toBuffer();

    return new Uint8Array(converted);
  } catch {
    return isPngOrJpeg ? input.body : null;
  }
}

function loadSharp(): SharpLike | null {
  if (cachedSharp !== undefined) {
    return cachedSharp;
  }

  try {
    const sharpModule = require("sharp") as SharpLike | { default?: SharpLike };

    if (typeof sharpModule === "function") {
      cachedSharp = sharpModule;
      return cachedSharp;
    }

    if (typeof sharpModule.default === "function") {
      cachedSharp = sharpModule.default;
      return cachedSharp;
    }

    cachedSharp = null;
    return null;
  } catch {
    cachedSharp = null;
    return null;
  }
}

async function renderOrderListPdf(
  rows: CombinedRow[],
  imageByUrl: Map<string, Uint8Array>,
  mode: CombinedPdfFlowMode
): Promise<Buffer> {
  return createPdfBuffer(async (doc) => {
    const fonts = resolvePdfFonts();
    const margin = 18;
    const columns = {
      orderId: 58,
      photo: 74,
      brand: 56,
      title: 199,
      ageGroup: 30,
      nmId: 68,
      sticker: 74
    };
    const borderColor = "#1F1F1F";
    const headerBackgroundColor = "#F2F2F2";
    const textColor = "#111111";

    const tableLeft = margin;
    const rowHeight = 96;
    const headerHeight = 26;
    const tableWidth =
      columns.orderId +
      columns.photo +
      columns.brand +
      columns.title +
      columns.ageGroup +
      columns.nmId +
      columns.sticker;

    const rowsBySupply = groupRowsBySupply(rows);

    doc.fillColor(textColor).font(fonts.regular).fontSize(ORDER_LIST_TEXT_FONT_SIZE);
    if (mode === "waiting") {
      doc.text(`${ORDER_LIST_TITLE.slice(0, -1)} `, margin, margin, {
        continued: true,
        lineBreak: false
      });
      doc.font(fonts.bold).text(WAITING_ORDER_LIST_TITLE_SUFFIX, {
        continued: true,
        lineBreak: false
      });
      doc.font(fonts.regular).text(":", { lineBreak: true });
    } else {
      doc.text(ORDER_LIST_TITLE, margin, margin);
    }
    doc.x = margin;
    doc.moveDown(0.2);
    doc.font(fonts.regular).fontSize(ORDER_LIST_TEXT_FONT_SIZE);

    for (const summary of rowsBySupply) {
      doc.text(`• Лист подбора ${summary.supplyId} - ${summary.count} Товаров`, {
        indent: 14
      });
    }

    doc.moveDown(0.4);
    doc
      .font(fonts.regular)
      .fontSize(ORDER_LIST_TEXT_FONT_SIZE)
      .text(`Количество товаров: ${rows.length}.`, margin, doc.y);

    if (rows.length === 0) {
      doc.moveDown(0.7);
      doc.font(fonts.regular).fontSize(12).text("Нет заказов по выбранным поставкам.", margin, doc.y);
      return;
    }

    let y = doc.y + 14;

    const drawHeader = () => {
      const labels = ["N задания", "Фото", "Бренд", "Наименование", "ВГ", "Арт.WB", "Стикеры"];
      const widths = [
        columns.orderId,
        columns.photo,
        columns.brand,
        columns.title,
        columns.ageGroup,
        columns.nmId,
        columns.sticker
      ];

      let x = tableLeft;

      doc
        .font(fonts.bold)
        .fontSize(ORDER_LIST_TABLE_FONT_SIZE)
        .lineWidth(0.8)
        .fillColor(textColor)
        .strokeColor(borderColor);

      for (let index = 0; index < labels.length; index += 1) {
        const width = widths[index] ?? 0;
        doc.rect(x, y, width, headerHeight).fillAndStroke(headerBackgroundColor, borderColor);
        doc.fillColor(textColor);
        doc.text(labels[index] ?? "", x + 4, y + 6, {
          width: width - 8,
          height: headerHeight - 8,
          align: "left",
          ellipsis: true,
          lineBreak: false
        });
        x += width;
      }

      doc
        .font(fonts.regular)
        .fontSize(ORDER_LIST_TABLE_FONT_SIZE)
        .fillColor(textColor)
        .strokeColor(borderColor);
      y += headerHeight;
    };

    if (y + headerHeight + rowHeight > doc.page.height - margin) {
      doc.addPage();
      y = margin;
    }

    drawHeader();

    for (const row of rows) {
      if (y + rowHeight > doc.page.height - margin) {
        doc.addPage();
        y = margin;
        drawHeader();
      }

      let x = tableLeft;

      doc.fontSize(ORDER_LIST_ORDER_ID_FONT_SIZE);
      drawCell(doc, x, y, columns.orderId, rowHeight, String(row.orderId), {
        align: "left",
        valign: "middle",
        lineBreak: false
      });
      doc.fontSize(ORDER_LIST_TABLE_FONT_SIZE);
      x += columns.orderId;

      drawCell(doc, x, y, columns.photo, rowHeight, "");
      const imageBuffer = row.img ? imageByUrl.get(row.img) : undefined;

      if (imageBuffer) {
        try {
          doc.image(Buffer.from(imageBuffer), x + 2, y + 2, {
            fit: [columns.photo - 4, rowHeight - 4],
            align: "center",
            valign: "center"
          });
        } catch {
          doc.text("-", x + 4, y + rowHeight / 2 - 4, { width: columns.photo - 8, align: "center" });
        }
      } else {
        doc.text("-", x + 4, y + rowHeight / 2 - 4, { width: columns.photo - 8, align: "center" });
      }

      x += columns.photo;
      drawCell(doc, x, y, columns.brand, rowHeight, row.brand ?? "-", { align: "left", valign: "top" });
      x += columns.brand;
      drawCell(doc, x, y, columns.title, rowHeight, row.title ?? "-", { align: "left", valign: "top" });
      x += columns.title;
      drawCell(doc, x, y, columns.ageGroup, rowHeight, row.ageGroup ?? "-", {
        align: "left",
        valign: "top"
      });
      x += columns.ageGroup;
      drawCell(doc, x, y, columns.nmId, rowHeight, row.nmId === null ? "-" : String(row.nmId), {
        align: "left",
        valign: "top"
      });
      x += columns.nmId;
      drawStickerCell(doc, x, y, columns.sticker, rowHeight, row.stickerPartA, row.stickerPartB, fonts);
      doc.font(fonts.regular).fontSize(ORDER_LIST_TABLE_FONT_SIZE);

      y += rowHeight;
    }

    doc.rect(tableLeft, y, tableWidth, 0.001).stroke();
  }, { size: "A4", margin: 0 });
}

async function renderStickersPdf(rows: CombinedRow[]): Promise<Buffer> {
  const stickers = rows
    .map((row) => ({
      orderId: row.orderId,
      fileBase64: row.stickerFileBase64,
      partA: row.stickerPartA,
      partB: row.stickerPartB
    }))
    .filter((item) => typeof item.fileBase64 === "string");

  return createPdfBuffer(async (doc) => {
    const fonts = resolvePdfFonts();

    if (stickers.length === 0) {
      doc.addPage({ size: "A4", margin: 24 });
      doc.font(fonts.regular).fontSize(12).text("WB API не вернул файлы стикеров.");
      return;
    }

    const width = mmToPoints(STICKER_MM_WIDTH);
    const height = mmToPoints(STICKER_MM_HEIGHT);

    for (let index = 0; index < stickers.length; index += 1) {
      const sticker = stickers[index];

      doc.addPage({ size: [width, height], margin: 0 });

      if (sticker?.fileBase64) {
        try {
          doc.image(decodeBase64(sticker.fileBase64), 0, 0, {
            fit: [width, height],
            align: "center",
            valign: "center"
          });
          continue;
        } catch {
          // Fallback text below.
        }
      }

      doc.font(fonts.regular).fontSize(8).text(`Заказ ${sticker?.orderId ?? "?"}`, 6, 8, { width: width - 12 });
      doc
        .fontSize(8)
        .text(`${sticker?.partA ?? ""} ${sticker?.partB ?? ""}`.trim(), 6, 20, { width: width - 12 });
    }
  }, { autoFirstPage: false, margin: 0 });
}

function drawCell(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  height: number,
  text: string,
  options?: { align?: "left" | "center" | "right"; valign?: "top" | "middle"; lineBreak?: boolean }
): void {
  const align = options?.align ?? "left";
  const valign = options?.valign ?? "top";
  const lineBreak = options?.lineBreak ?? true;
  const paddingX = 4;
  const paddingY = 4;
  const textBoxWidth = width - paddingX * 2;
  const textBoxHeight = height - paddingY * 2;

  doc.rect(x, y, width, height).stroke();

  const textHeight = doc.heightOfString(text, {
    width: textBoxWidth,
    ellipsis: true,
    align,
    lineBreak
  });
  const middleOffset = Math.max(0, (textBoxHeight - textHeight) / 2);
  const textY = y + paddingY + (valign === "middle" ? middleOffset : 0);

  doc.text(text, x + paddingX, textY, {
    width: textBoxWidth,
    height: textBoxHeight,
    ellipsis: true,
    align,
    lineBreak
  });
}

function drawStickerCell(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  height: number,
  partA: string | null,
  partB: string | null,
  fonts: { regular: string; bold: string }
): void {
  doc.rect(x, y, width, height).stroke();

  const left = x + 4;
  const textTop = y + 8;
  const textWidth = width - 8;

  if (partA === null && partB === null) {
    doc.font(fonts.regular).fontSize(ORDER_LIST_TABLE_FONT_SIZE).text("-", left, y + height / 2 - 4, {
      width: textWidth,
      align: "left"
    });
    return;
  }

  const partAText = partA ?? "";
  const partBText = partB ?? "";
  const partAWithSpace = partAText.length > 0 ? `${partAText} ` : "";

  doc.font(fonts.regular).fontSize(7);
  const partAWidth = doc.widthOfString(partAWithSpace);
  doc.text(partAWithSpace, left, textTop + 1, {
    width: textWidth,
    lineBreak: false,
    ellipsis: true
  });

  doc.font(fonts.bold).fontSize(10).text(partBText, left + partAWidth, textTop, {
    width: Math.max(0, textWidth - partAWidth),
    lineBreak: false,
    ellipsis: true
  });
}

function resolvePdfFonts(): { regular: string; bold: string } {
  if (!existsSync(PDF_FONT_REGULAR_PATH) || !existsSync(PDF_FONT_BOLD_PATH)) {
    throw new Error(
      "NotoSans font files were not found in packages/core/assets/fonts. Expected NotoSans-Regular.ttf and NotoSans-Bold.ttf."
    );
  }

  return {
    regular: PDF_FONT_REGULAR_PATH,
    bold: PDF_FONT_BOLD_PATH
  };
}

function resolveCoreAssetPath(...segments: string[]): string {
  const currentFilePath = fileURLToPath(import.meta.url);
  return resolve(dirname(currentFilePath), "..", "assets", ...segments);
}

function groupRowsBySupply(rows: CombinedRow[]): Array<{ supplyId: string; count: number }> {
  const bySupply = new Map<string, number>();

  for (const row of rows) {
    bySupply.set(row.supplyId, (bySupply.get(row.supplyId) ?? 0) + 1);
  }

  return [...bySupply.entries()]
    .sort((left, right) => left[0].localeCompare(right[0], "ru"))
    .map(([supplyId, count]) => ({ supplyId, count }));
}

async function createPdfBuffer(
  draw: (doc: PDFKit.PDFDocument) => Promise<void> | void,
  options: PDFKit.PDFDocumentOptions
): Promise<Buffer> {
  const doc = new PDFDocument(options);
  const chunks: Buffer[] = [];

  const completed = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Uint8Array) => {
      chunks.push(Buffer.from(chunk));
    });

    doc.on("end", () => {
      resolve(Buffer.concat(chunks));
    });

    doc.on("error", reject);
  });

  await draw(doc);
  doc.end();

  return completed;
}

function decodeBase64(value: string): Buffer {
  const normalized = value.includes("base64,") ? value.split("base64,")[1] ?? "" : value;
  return Buffer.from(normalized.trim(), "base64");
}

function mmToPoints(valueMm: number): number {
  return (valueMm / 25.4) * 72;
}

function resolveFbsCredentials(shop: Shop): { token: string; baseUrl?: string } {
  if (!shop.useSandbox) {
    return { token: shop.wbToken };
  }

  if (!shop.wbSandboxToken) {
    throw new Error(`Shop ${shop.id} is configured for sandbox but wbSandboxToken is empty`);
  }

  return {
    token: shop.wbSandboxToken,
    baseUrl: WB_FBS_SANDBOX_API_BASE_URL
  };
}

function parseDateOrNull(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatRuFileDate(date: Date): string {
  const months = [
    "января",
    "февраля",
    "марта",
    "апреля",
    "мая",
    "июня",
    "июля",
    "августа",
    "сентября",
    "октября",
    "ноября",
    "декабря"
  ];

  const day = pad2(date.getUTCDate());
  const month = months[date.getUTCMonth()] ?? months[0];
  return `${day}_${month}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

async function defaultFetchImage(url: string): Promise<ImageFetchResult> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Image fetch failed with status ${response.status}`);
  }

  return {
    contentType: response.headers.get("content-type"),
    body: new Uint8Array(await response.arrayBuffer())
  };
}
