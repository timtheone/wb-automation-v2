import {
  createWbFbsClient,
  WB_FBS_SANDBOX_API_BASE_URL,
  type FbsPaths,
  type WbFbsClient
} from "@wb-automation-v2/wb-clients";
import { createShopRepository, type Database, type Shop } from "@wb-automation-v2/db";

import { formatEmptyResponseMessage, toErrorMessage } from "./error-utils.js";

const DEFAULT_SUPPLY_PAGE_LIMIT = 1_000;
const DEFAULT_POLL_ATTEMPTS = 20;
const DEFAULT_POLL_INTERVAL_MS = 1_000;
const SUPPLY_ORDER_BATCH_SIZE = 100;

type CreateSupplyOperation = FbsPaths["/api/v3/supplies"]["post"];
type AddOrdersOperation = FbsPaths["/api/marketplace/v3/supplies/{supplyId}/orders"]["patch"];

type CreateSupplyBody = CreateSupplyOperation["requestBody"]["content"]["application/json"];
type AddOrdersBody = AddOrdersOperation["requestBody"]["content"]["application/json"];

export interface ProcessAllShopsResultItem {
  shopId: string;
  shopName: string;
  status: "success" | "skipped" | "failed";
  supplyId: string | null;
  ordersInNew: number;
  ordersSkippedByMeta: number;
  ordersAttached: number;
  barcode: string | null;
  barcodeFile: string | null;
  error: string | null;
}

export interface ProcessAllShopsResult {
  startedAt: Date;
  finishedAt: Date;
  processedShops: number;
  successCount: number;
  skippedCount: number;
  failureCount: number;
  results: ProcessAllShopsResultItem[];
}

export interface ProcessAllShopsWbApiDebugEvent {
  shopId: string;
  shopName: string;
  useSandbox: boolean;
  step:
    | "orders_new"
    | "orders_new_no_eligible"
    | "supplies_list"
    | "supplies_open_found"
    | "supplies_open_not_found"
    | "supply_create"
    | "supply_add_orders"
    | "supply_deliver"
    | "supply_poll"
    | "supply_poll_timeout"
    | "supply_barcode"
    | "shop_failed";
  requestMethod?: "GET" | "POST" | "PATCH";
  requestPath?: string;
  requestQuery?: Record<string, unknown>;
  requestBody?: Record<string, unknown>;
  responseStatus?: number;
  responseUrl?: string;
  responseData?: Record<string, unknown>;
  error?: string;
}

type ProcessAllShopsOptions = {
  tenantId: string;
  db: Database;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  supplyPageLimit?: number;
  maxPollAttempts?: number;
  pollIntervalMs?: number;
  onWbApiDebug?: (event: ProcessAllShopsWbApiDebugEvent) => void;
};

export interface ProcessAllShopsService {
  processAllShops(): Promise<ProcessAllShopsResult>;
}

export function createProcessAllShopsService(options: ProcessAllShopsOptions): ProcessAllShopsService {
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? defaultSleep;
  const supplyPageLimit = options.supplyPageLimit ?? DEFAULT_SUPPLY_PAGE_LIMIT;
  const maxPollAttempts = options.maxPollAttempts ?? DEFAULT_POLL_ATTEMPTS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const onWbApiDebug = options.onWbApiDebug;
  const shops = createShopRepository({
    tenantId: options.tenantId,
    db: options.db
  });

  return {
    async processAllShops() {
      const startedAt = now();
      const activeShops = await shops.listActiveShops();
      const results: ProcessAllShopsResultItem[] = [];

      for (const shop of activeShops) {
        const debugContext: ProcessAllShopsDebugContext = {
          shopId: shop.id,
          shopName: shop.name,
          useSandbox: shop.useSandbox,
          onWbApiDebug
        };

        try {
          const credentials = resolveFbsCredentials(shop);
          const fbsClient = createWbFbsClient(credentials);
          const newOrdersResult = await fbsClient.GET("/api/v3/orders/new");

          emitWbApiDebug(debugContext, {
            step: "orders_new",
            requestMethod: "GET",
            requestPath: "/api/v3/orders/new",
            responseStatus: newOrdersResult.response.status,
            responseUrl: newOrdersResult.response.url,
            responseData: summarizeOrdersNewResponse(newOrdersResult.data)
          });

          if (newOrdersResult.data === undefined) {
            throw new Error(formatEmptyResponseMessage(newOrdersResult.response));
          }

          const allOrders = newOrdersResult.data.orders ?? [];
          const eligibleOrders = allOrders.filter((order) => {
            const requiredMeta = order.requiredMeta;
            return !requiredMeta || requiredMeta.length === 0;
          });
          const eligibleOrderIds = eligibleOrders
            .map((order) => order.id)
            .filter((id): id is number => typeof id === "number");
          const skippedByMeta = allOrders.length - eligibleOrders.length;

          if (eligibleOrderIds.length === 0) {
            emitWbApiDebug(debugContext, {
              step: "orders_new_no_eligible",
              responseData: {
                totalOrders: allOrders.length,
                ordersSkippedByMeta: skippedByMeta
              }
            });

            results.push({
              shopId: shop.id,
              shopName: shop.name,
              status: "skipped",
              supplyId: null,
              ordersInNew: allOrders.length,
              ordersSkippedByMeta: skippedByMeta,
              ordersAttached: 0,
              barcode: null,
              barcodeFile: null,
              error: null
            });
            continue;
          }

          const supplyId = await resolveSupplyId({
            fbsClient,
            supplyPrefix: shop.supplyPrefix,
            now,
            supplyPageLimit,
            debugContext
          });

          for (const batch of toBatches(eligibleOrderIds, SUPPLY_ORDER_BATCH_SIZE)) {
            const body: AddOrdersBody = { orders: batch };
            const addOrdersResult = await fbsClient.PATCH("/api/marketplace/v3/supplies/{supplyId}/orders", {
              params: {
                path: { supplyId }
              },
              body
            });

            emitWbApiDebug(debugContext, {
              step: "supply_add_orders",
              requestMethod: "PATCH",
              requestPath: "/api/marketplace/v3/supplies/{supplyId}/orders",
              requestBody: {
                supplyId,
                batchSize: batch.length,
                firstOrderId: batch[0] ?? null,
                lastOrderId: batch[batch.length - 1] ?? null
              },
              responseStatus: addOrdersResult.response.status,
              responseUrl: addOrdersResult.response.url
            });
          }

          const deliverResult = await fbsClient.PATCH("/api/v3/supplies/{supplyId}/deliver", {
            params: {
              path: { supplyId }
            }
          });

          emitWbApiDebug(debugContext, {
            step: "supply_deliver",
            requestMethod: "PATCH",
            requestPath: "/api/v3/supplies/{supplyId}/deliver",
            requestBody: {
              supplyId
            },
            responseStatus: deliverResult.response.status,
            responseUrl: deliverResult.response.url
          });

          await waitUntilSupplyClosed({
            fbsClient,
            supplyId,
            maxPollAttempts,
            pollIntervalMs,
            sleep,
            debugContext
          });

          const barcodeResult = await fbsClient.GET("/api/v3/supplies/{supplyId}/barcode", {
            params: {
              path: { supplyId },
              query: { type: "png" }
            }
          });

          emitWbApiDebug(debugContext, {
            step: "supply_barcode",
            requestMethod: "GET",
            requestPath: "/api/v3/supplies/{supplyId}/barcode",
            requestQuery: {
              supplyId,
              type: "png"
            },
            responseStatus: barcodeResult.response.status,
            responseUrl: barcodeResult.response.url,
            responseData: summarizeBarcodeResponse(barcodeResult.data)
          });

          if (barcodeResult.data === undefined) {
            throw new Error(formatEmptyResponseMessage(barcodeResult.response));
          }

          results.push({
            shopId: shop.id,
            shopName: shop.name,
            status: "success",
            supplyId,
            ordersInNew: allOrders.length,
            ordersSkippedByMeta: skippedByMeta,
            ordersAttached: eligibleOrderIds.length,
            barcode: barcodeResult.data.barcode ?? null,
            barcodeFile: barcodeResult.data.file ?? null,
            error: null
          });
        } catch (error) {
          emitWbApiDebug(debugContext, {
            step: "shop_failed",
            error: toErrorMessage(error)
          });

          results.push({
            shopId: shop.id,
            shopName: shop.name,
            status: "failed",
            supplyId: null,
            ordersInNew: 0,
            ordersSkippedByMeta: 0,
            ordersAttached: 0,
            barcode: null,
            barcodeFile: null,
            error: toErrorMessage(error)
          });
        }
      }

      const successCount = results.filter((item) => item.status === "success").length;
      const skippedCount = results.filter((item) => item.status === "skipped").length;

      return {
        startedAt,
        finishedAt: now(),
        processedShops: results.length,
        successCount,
        skippedCount,
        failureCount: results.length - successCount - skippedCount,
        results
      };
    }
  };
}

async function resolveSupplyId(input: {
  fbsClient: WbFbsClient;
  supplyPrefix: string;
  now: () => Date;
  supplyPageLimit: number;
  debugContext: ProcessAllShopsDebugContext;
}): Promise<string> {
  const existingSupplyId = await findOpenSupplyId(input);

  if (existingSupplyId) {
    return existingSupplyId;
  }

  const body: CreateSupplyBody = {
    name: `${input.supplyPrefix}${formatSupplyTimestamp(input.now())}`
  };
  const createdResult = await input.fbsClient.POST("/api/v3/supplies", { body });

  emitWbApiDebug(input.debugContext, {
    step: "supply_create",
    requestMethod: "POST",
    requestPath: "/api/v3/supplies",
    requestBody: {
      name: body.name
    },
    responseStatus: createdResult.response.status,
    responseUrl: createdResult.response.url,
    responseData: summarizeCreateSupplyResponse(createdResult.data)
  });

  if (createdResult.data === undefined) {
    throw new Error(formatEmptyResponseMessage(createdResult.response));
  }

  if (!createdResult.data.id) {
    throw new Error("WB API did not return supply id");
  }

  return createdResult.data.id;
}

async function findOpenSupplyId(input: {
  fbsClient: WbFbsClient;
  supplyPrefix: string;
  supplyPageLimit: number;
  debugContext: ProcessAllShopsDebugContext;
}): Promise<string | null> {
  let next = 0;
  const seenCursors = new Set<number>();

  while (true) {
    if (seenCursors.has(next)) {
      throw new Error(`Supplies cursor loop detected at next=${next}`);
    }

    seenCursors.add(next);

    const suppliesResult = await input.fbsClient.GET("/api/v3/supplies", {
      params: {
        query: {
          limit: input.supplyPageLimit,
          next
        }
      }
    });

    emitWbApiDebug(input.debugContext, {
      step: "supplies_list",
      requestMethod: "GET",
      requestPath: "/api/v3/supplies",
      requestQuery: {
        limit: input.supplyPageLimit,
        next
      },
      responseStatus: suppliesResult.response.status,
      responseUrl: suppliesResult.response.url,
      responseData: summarizeSuppliesListResponse(suppliesResult.data)
    });

    if (suppliesResult.data === undefined) {
      throw new Error(formatEmptyResponseMessage(suppliesResult.response));
    }

    const openSupply = suppliesResult.data.supplies?.find(
      (supply) =>
        supply.done === false &&
        typeof supply.id === "string" &&
        typeof supply.name === "string" &&
        supply.name.startsWith(input.supplyPrefix)
    );

    if (openSupply?.id) {
      emitWbApiDebug(input.debugContext, {
        step: "supplies_open_found",
        responseData: {
          supplyId: openSupply.id,
          supplyName: openSupply.name,
          cursorNext: suppliesResult.data.next ?? null
        }
      });

      return openSupply.id;
    }

    const nextCursor = suppliesResult.data.next;

    if (typeof nextCursor !== "number" || nextCursor <= 0) {
      emitWbApiDebug(input.debugContext, {
        step: "supplies_open_not_found",
        responseData: {
          cursorNext: nextCursor ?? null
        }
      });

      return null;
    }

    next = nextCursor;
  }
}

async function waitUntilSupplyClosed(input: {
  fbsClient: WbFbsClient;
  supplyId: string;
  maxPollAttempts: number;
  pollIntervalMs: number;
  sleep: (ms: number) => Promise<void>;
  debugContext: ProcessAllShopsDebugContext;
}) {
  for (let attempt = 1; attempt <= input.maxPollAttempts; attempt += 1) {
    const supplyResult = await input.fbsClient.GET("/api/v3/supplies/{supplyId}", {
      params: {
        path: { supplyId: input.supplyId }
      }
    });

    emitWbApiDebug(input.debugContext, {
      step: "supply_poll",
      requestMethod: "GET",
      requestPath: "/api/v3/supplies/{supplyId}",
      requestQuery: {
        supplyId: input.supplyId,
        attempt,
        maxPollAttempts: input.maxPollAttempts
      },
      responseStatus: supplyResult.response.status,
      responseUrl: supplyResult.response.url,
      responseData: summarizeSupplyPollResponse(supplyResult.data)
    });

    if (supplyResult.data === undefined) {
      throw new Error(formatEmptyResponseMessage(supplyResult.response));
    }

    if (supplyResult.data.done) {
      return;
    }

    if (attempt < input.maxPollAttempts) {
      await input.sleep(input.pollIntervalMs);
    }
  }

  emitWbApiDebug(input.debugContext, {
    step: "supply_poll_timeout",
    responseData: {
      supplyId: input.supplyId,
      maxPollAttempts: input.maxPollAttempts
    }
  });

  throw new Error(`Timed out waiting for supply ${input.supplyId} to close`);
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

function toBatches(values: number[], size: number): number[][] {
  const result: number[][] = [];

  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }

  return result;
}

function formatSupplyTimestamp(date: Date): string {
  const parts = new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/Moscow"
  }).formatToParts(date);
  const day = getDatePart(parts, "day");
  const month = getDatePart(parts, "month").toLowerCase();
  const hour = getDatePart(parts, "hour");
  const minute = getDatePart(parts, "minute");

  return `${day}_${month}_${hour}:${minute}`;
}

function getDatePart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((part) => part.type === type)?.value ?? "";
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

type ProcessAllShopsDebugContext = {
  shopId: string;
  shopName: string;
  useSandbox: boolean;
  onWbApiDebug?: (event: ProcessAllShopsWbApiDebugEvent) => void;
};

function emitWbApiDebug(
  context: ProcessAllShopsDebugContext,
  event: Omit<ProcessAllShopsWbApiDebugEvent, "shopId" | "shopName" | "useSandbox">
) {
  if (!context.onWbApiDebug) {
    return;
  }

  context.onWbApiDebug({
    ...event,
    shopId: context.shopId,
    shopName: context.shopName,
    useSandbox: context.useSandbox
  });
}

function summarizeOrdersNewResponse(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object") {
    return {
      hasData: false
    };
  }

  const payload = data as {
    orders?: Array<{
      id?: unknown;
      requiredMeta?: unknown;
    }>;
  };

  const orders = Array.isArray(payload.orders) ? payload.orders : [];

  return {
    hasData: true,
    totalOrders: orders.length,
    orders: orders.slice(0, 25).map((order) => ({
      id: typeof order.id === "number" ? order.id : null,
      requiredMeta: Array.isArray(order.requiredMeta)
        ? order.requiredMeta.filter((value): value is string => typeof value === "string")
        : []
    }))
  };
}

function summarizeSuppliesListResponse(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object") {
    return {
      hasData: false
    };
  }

  const payload = data as {
    next?: unknown;
    supplies?: Array<{
      id?: unknown;
      name?: unknown;
      done?: unknown;
    }>;
  };

  const supplies = Array.isArray(payload.supplies) ? payload.supplies : [];

  return {
    hasData: true,
    next: typeof payload.next === "number" ? payload.next : null,
    suppliesCount: supplies.length,
    supplies: supplies.slice(0, 25).map((supply) => ({
      id: typeof supply.id === "string" ? supply.id : null,
      name: typeof supply.name === "string" ? supply.name : null,
      done: typeof supply.done === "boolean" ? supply.done : null
    }))
  };
}

function summarizeCreateSupplyResponse(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object") {
    return {
      hasData: false
    };
  }

  const payload = data as {
    id?: unknown;
  };

  return {
    hasData: true,
    id: typeof payload.id === "string" ? payload.id : null
  };
}

function summarizeSupplyPollResponse(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object") {
    return {
      hasData: false
    };
  }

  const payload = data as {
    id?: unknown;
    done?: unknown;
    name?: unknown;
  };

  return {
    hasData: true,
    id: typeof payload.id === "string" ? payload.id : null,
    name: typeof payload.name === "string" ? payload.name : null,
    done: typeof payload.done === "boolean" ? payload.done : null
  };
}

function summarizeBarcodeResponse(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object") {
    return {
      hasData: false
    };
  }

  const payload = data as {
    barcode?: unknown;
    file?: unknown;
  };

  const file = typeof payload.file === "string" ? payload.file : null;

  return {
    hasData: true,
    barcode: typeof payload.barcode === "string" ? payload.barcode : null,
    hasFile: file !== null,
    fileBase64Length: file?.length ?? 0
  };
}
