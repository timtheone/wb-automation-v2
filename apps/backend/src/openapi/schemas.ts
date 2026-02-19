import { z } from "@hono/zod-openapi";

export const errorResponseSchema = z.object({
  code: z.string().optional(),
  error: z.string(),
  details: z.any().optional()
}).openapi("ErrorResponse");

export const notImplementedResponseSchema = z.object({
  code: z.string(),
  error: z.string()
}).openapi("NotImplementedResponse");

export const shopSchema = z.object({
  id: z.string(),
  name: z.string(),
  wbToken: z.string(),
  wbSandboxToken: z.string().nullable(),
  useSandbox: z.boolean(),
  isActive: z.boolean(),
  supplyPrefix: z.string(),
  tokenUpdatedAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
}).openapi("Shop");

export const shopsResponseSchema = z.object({
  shops: z.array(shopSchema)
}).openapi("ShopsResponse");

export const shopResponseSchema = z.object({
  shop: shopSchema
}).openapi("ShopResponse");

const processAllShopsItemSchema = z.object({
  shopId: z.string(),
  shopName: z.string(),
  status: z.enum(["success", "skipped", "failed"]),
  supplyId: z.string().nullable(),
  ordersInNew: z.number().int(),
  ordersSkippedByMeta: z.number().int(),
  ordersAttached: z.number().int(),
  barcode: z.string().nullable(),
  barcodeFile: z.string().nullable(),
  error: z.string().nullable()
}).openapi("ProcessAllShopsItem");

export const processAllShopsResultSchema = z.object({
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime(),
  processedShops: z.number().int(),
  successCount: z.number().int(),
  skippedCount: z.number().int(),
  failureCount: z.number().int(),
  results: z.array(processAllShopsItemSchema)
}).openapi("ProcessAllShopsResult");

const syncContentShopsItemSchema = z.object({
  shopId: z.string(),
  shopName: z.string(),
  pagesFetched: z.number().int(),
  cardsUpserted: z.number().int(),
  status: z.enum(["success", "failed"]),
  error: z.string().nullable()
}).openapi("SyncContentShopsItem");

export const syncContentShopsResultSchema = z.object({
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime(),
  processedShops: z.number().int(),
  successCount: z.number().int(),
  failureCount: z.number().int(),
  totalCardsUpserted: z.number().int(),
  results: z.array(syncContentShopsItemSchema)
}).openapi("SyncContentShopsResult");

const combinedPdfListsItemSchema = z.object({
  shopId: z.string(),
  shopName: z.string(),
  status: z.enum(["success", "skipped", "failed"]),
  supplyIds: z.array(z.string()),
  orderIds: z.array(z.number().int()),
  ordersCollected: z.number().int(),
  missingProductCards: z.number().int(),
  error: z.string().nullable()
}).openapi("CombinedPdfListsItem");

export const combinedPdfListsResultSchema = z.object({
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime(),
  processedShops: z.number().int(),
  successCount: z.number().int(),
  skippedCount: z.number().int(),
  failureCount: z.number().int(),
  totalOrdersCollected: z.number().int(),
  orderListFileName: z.string(),
  stickersFileName: z.string(),
  orderListPdfBase64: z.string(),
  stickersPdfBase64: z.string(),
  results: z.array(combinedPdfListsItemSchema)
}).openapi("CombinedPdfListsResult");

export const combinedPdfListsJobAcceptedSchema = z.object({
  jobId: z.string(),
  status: z.enum(["queued", "running"]),
  createdAt: z.iso.datetime()
}).openapi("CombinedPdfListsJobAccepted");

export const combinedPdfListsJobStatusSchema = z.object({
  jobId: z.string(),
  status: z.enum(["queued", "running", "completed", "failed"]),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
  error: z.string().nullable(),
  result: combinedPdfListsResultSchema.nullable()
}).openapi("CombinedPdfListsJobStatus");
