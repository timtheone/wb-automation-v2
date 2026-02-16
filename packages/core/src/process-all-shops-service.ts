import { createWbFbsClient, type FbsPaths, type WbFbsClient } from "@wb-automation-v2/wb-clients";
import { createShopRepository, type Database } from "@wb-automation-v2/db";

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

type ProcessAllShopsOptions = {
  db: Database;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  supplyPageLimit?: number;
  maxPollAttempts?: number;
  pollIntervalMs?: number;
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
  const shops = createShopRepository(options.db);

  return {
    async processAllShops() {
      const startedAt = now();
      const activeShops = await shops.listActiveShops();
      const results: ProcessAllShopsResultItem[] = [];

      for (const shop of activeShops) {
        const fbsClient = createWbFbsClient({ token: shop.wbToken });

        try {
          const newOrdersResult = await fbsClient.GET("/api/v3/orders/new");

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
            supplyPageLimit
          });

          for (const batch of toBatches(eligibleOrderIds, SUPPLY_ORDER_BATCH_SIZE)) {
            const body: AddOrdersBody = { orders: batch };
            await fbsClient.PATCH("/api/marketplace/v3/supplies/{supplyId}/orders", {
              params: {
                path: { supplyId }
              },
              body
            });
          }

          await fbsClient.PATCH("/api/v3/supplies/{supplyId}/deliver", {
            params: {
              path: { supplyId }
            }
          });

          await waitUntilSupplyClosed({
            fbsClient,
            supplyId,
            maxPollAttempts,
            pollIntervalMs,
            sleep
          });

          const barcodeResult = await fbsClient.GET("/api/v3/supplies/{supplyId}/barcode", {
            params: {
              path: { supplyId },
              query: { type: "svg" }
            }
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
}): Promise<string> {
  const existingSupplyId = await findOpenSupplyId(input);

  if (existingSupplyId) {
    return existingSupplyId;
  }

  const body: CreateSupplyBody = {
    name: `${input.supplyPrefix}${formatSupplyTimestamp(input.now())}`
  };
  const createdResult = await input.fbsClient.POST("/api/v3/supplies", { body });

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
      return openSupply.id;
    }

    const nextCursor = suppliesResult.data.next;

    if (typeof nextCursor !== "number" || nextCursor <= 0) {
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
}) {
  for (let attempt = 1; attempt <= input.maxPollAttempts; attempt += 1) {
    const supplyResult = await input.fbsClient.GET("/api/v3/supplies/{supplyId}", {
      params: {
        path: { supplyId: input.supplyId }
      }
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

  throw new Error(`Timed out waiting for supply ${input.supplyId} to close`);
}

function toBatches(values: number[], size: number): number[][] {
  const result: number[][] = [];

  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }

  return result;
}

function formatSupplyTimestamp(date: Date): string {
  const year = date.getUTCFullYear();
  const month = pad2(date.getUTCMonth() + 1);
  const day = pad2(date.getUTCDate());
  const hour = pad2(date.getUTCHours());
  const minute = pad2(date.getUTCMinutes());

  return `${year}${month}${day}_${hour}${minute}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
