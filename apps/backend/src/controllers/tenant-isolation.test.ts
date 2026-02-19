import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import type { Context } from "hono";

import { registerFlowsController } from "./flows-controller.js";
import { registerShopsController } from "./shops-controller.js";
import { RequestValidationError } from "../http/validation.js";
import type { BackendFlowsService } from "../services/flows-service.js";
import type { BackendShopsService } from "../services/shops-service.js";
import type { BackendTenantService } from "../services/tenant-service.js";

type TelegramChatType = "private" | "group" | "supergroup" | "channel";

interface Shop {
  id: string;
  name: string;
  wbToken: string;
  wbSandboxToken: string | null;
  useSandbox: boolean;
  isActive: boolean;
  supplyPrefix: string;
  tokenUpdatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

class TestShopNotFoundError extends Error {
  constructor(shopId: string) {
    super(`Shop not found: ${shopId}`);
  }
}

describe("tenant isolation via backend controllers", () => {
  it("prevents cross-tenant shop reads and mutations", async () => {
    const shopsService = new InMemoryTenantShopsService();
    const app = createShopsTestApp({ shopsService });

    const tenantAHeaders = createTelegramHeaders({
      chatId: 101,
      chatType: "private",
      requesterTelegramUserId: 101,
      ownerTelegramUserId: 101
    });
    const tenantBHeaders = createTelegramHeaders({
      chatId: 202,
      chatType: "private",
      requesterTelegramUserId: 202,
      ownerTelegramUserId: 202
    });

    const createResponse = await app.request("/shops", {
      method: "POST",
      headers: {
        ...tenantAHeaders,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        name: "Tenant A Shop",
        wbToken: "token-a"
      })
    });

    expect(createResponse.status).toBe(201);
    const createPayload = (await createResponse.json()) as { shop: Shop };
    const tenantAShopId = createPayload.shop.id;

    const tenantBListResponse = await app.request("/shops", {
      method: "GET",
      headers: tenantBHeaders
    });

    expect(tenantBListResponse.status).toBe(200);
    expect((await tenantBListResponse.json()) as { shops: Shop[] }).toEqual({ shops: [] });

    const tenantBUpdateResponse = await app.request(`/shops/${tenantAShopId}`, {
      method: "PATCH",
      headers: {
        ...tenantBHeaders,
        "content-type": "application/json"
      },
      body: JSON.stringify({ name: "Hacked" })
    });
    expect(tenantBUpdateResponse.status).toBe(404);
    expect((await tenantBUpdateResponse.json()) as { code: string }).toMatchObject({
      code: "SHOP_NOT_FOUND"
    });

    const tenantBTokenResponse = await app.request(`/shops/${tenantAShopId}/token`, {
      method: "PATCH",
      headers: {
        ...tenantBHeaders,
        "content-type": "application/json"
      },
      body: JSON.stringify({ wbToken: "new-token" })
    });
    expect(tenantBTokenResponse.status).toBe(404);
    expect((await tenantBTokenResponse.json()) as { code: string }).toMatchObject({
      code: "SHOP_NOT_FOUND"
    });

    const tenantBDeleteResponse = await app.request(`/shops/${tenantAShopId}`, {
      method: "DELETE",
      headers: tenantBHeaders
    });
    expect(tenantBDeleteResponse.status).toBe(404);
    expect((await tenantBDeleteResponse.json()) as { code: string }).toMatchObject({
      code: "SHOP_NOT_FOUND"
    });

    const tenantAListResponse = await app.request("/shops", {
      method: "GET",
      headers: tenantAHeaders
    });

    expect(tenantAListResponse.status).toBe(200);
    const tenantAListPayload = (await tenantAListResponse.json()) as { shops: Shop[] };
    expect(tenantAListPayload.shops).toHaveLength(1);
    expect(tenantAListPayload.shops[0]).toMatchObject({
      id: tenantAShopId,
      name: "Tenant A Shop",
      wbToken: "token-a",
      isActive: true
    });
  });

  it("scopes group chat operations by owner instead of requester", async () => {
    const shopsService = new InMemoryTenantShopsService();
    const app = createShopsTestApp({ shopsService });

    const groupMemberAHeaders = createTelegramHeaders({
      chatId: 9999,
      chatType: "group",
      requesterTelegramUserId: 111,
      ownerTelegramUserId: 5000
    });
    const groupMemberBHeaders = createTelegramHeaders({
      chatId: 9999,
      chatType: "group",
      requesterTelegramUserId: 222,
      ownerTelegramUserId: 5000
    });
    const otherOwnerHeaders = createTelegramHeaders({
      chatId: 8888,
      chatType: "group",
      requesterTelegramUserId: 333,
      ownerTelegramUserId: 6000
    });

    const createResponse = await app.request("/shops", {
      method: "POST",
      headers: {
        ...groupMemberAHeaders,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        name: "Shared Group Shop",
        wbToken: "token-group"
      })
    });

    expect(createResponse.status).toBe(201);

    const sameOwnerListResponse = await app.request("/shops", {
      method: "GET",
      headers: groupMemberBHeaders
    });
    expect(sameOwnerListResponse.status).toBe(200);
    expect(((await sameOwnerListResponse.json()) as { shops: Shop[] }).shops).toHaveLength(1);

    const otherOwnerListResponse = await app.request("/shops", {
      method: "GET",
      headers: otherOwnerHeaders
    });
    expect(otherOwnerListResponse.status).toBe(200);
    expect((await otherOwnerListResponse.json()) as { shops: Shop[] }).toEqual({ shops: [] });
  });

  it("runs flow handlers under the resolved tenant owner", async () => {
    const flowsService = new RecordingFlowsService();
    const app = createFlowsTestApp({ flowsService });

    const groupHeaders = createTelegramHeaders({
      chatId: 77,
      chatType: "supergroup",
      requesterTelegramUserId: 1111,
      ownerTelegramUserId: 9000
    });
    const secondTenantHeaders = createTelegramHeaders({
      chatId: 78,
      chatType: "private",
      requesterTelegramUserId: 42,
      ownerTelegramUserId: 42
    });

    const processResponse = await app.request("/flows/process-all-shops", {
      method: "POST",
      headers: groupHeaders
    });
    expect(processResponse.status).toBe(200);

    const syncResponse = await app.request("/flows/sync-content-shops", {
      method: "POST",
      headers: secondTenantHeaders
    });
    expect(syncResponse.status).toBe(200);

    const combinedResponse = await app.request("/flows/get-combined-pdf-lists", {
      method: "POST",
      headers: groupHeaders
    });
    expect(combinedResponse.status).toBe(202);
    const combinedJob = (await combinedResponse.json()) as { jobId: string };

    const combinedStatusResponse = await app.request(`/flows/get-combined-pdf-lists/${combinedJob.jobId}`, {
      method: "GET",
      headers: groupHeaders
    });
    expect(combinedStatusResponse.status).toBe(200);

    expect(flowsService.processCalls).toEqual(["tenant-9000"]);
    expect(flowsService.syncCalls).toEqual(["tenant-42"]);
    expect(flowsService.combinedStartCalls).toEqual([{ tenantId: "tenant-9000", chatId: 77 }]);
    expect(flowsService.combinedStatusCalls).toEqual(["tenant-9000"]);
  });
});

function createShopsTestApp(input: { shopsService: BackendShopsService }): OpenAPIHono {
  const app = new OpenAPIHono();
  const tenantService = new DeterministicTenantService();
  const handleRouteError = testRouteErrorHandler;

  registerShopsController(app, {
    shopsService: input.shopsService,
    tenantService,
    handleRouteError
  });

  return app;
}

function createFlowsTestApp(input: { flowsService: BackendFlowsService }): OpenAPIHono {
  const app = new OpenAPIHono();
  const tenantService = new DeterministicTenantService();
  const handleRouteError = testRouteErrorHandler;

  registerFlowsController(app, {
    flowsService: input.flowsService,
    tenantService,
    handleRouteError
  });

  return app;
}

function testRouteErrorHandler(c: Context, error: unknown): Response {
  if (error instanceof RequestValidationError) {
    return c.json({ code: error.code, error: error.message, details: error.details }, 400);
  }

  if (error instanceof TestShopNotFoundError) {
    return c.json({ code: "SHOP_NOT_FOUND", error: error.message }, 404);
  }

  return c.json({ code: "INTERNAL_SERVER_ERROR", error: "Internal server error" }, 500);
}

class DeterministicTenantService implements BackendTenantService {
  async listTenantContexts(): Promise<Array<{ tenantId: string; ownerTelegramUserId: number }>> {
    return [];
  }

  async resolveTenantContext(input: {
    chatId: number;
    chatType: TelegramChatType;
    requesterTelegramUserId: number;
    ownerTelegramUserId: number;
    languageCode?: string;
  }) {
    return {
      ...input,
      tenantId: `tenant-${input.ownerTelegramUserId}`
    };
  }
}

class InMemoryTenantShopsService implements BackendShopsService {
  private readonly shopsByTenant = new Map<string, Map<string, Shop>>();
  private sequence = 0;

  async listShops(tenantId: string): Promise<Shop[]> {
    return this.readTenantShops(tenantId);
  }

  async createShop(tenantId: string, input: {
    name: string;
    wbToken: string;
    wbSandboxToken?: string | null;
    useSandbox?: boolean;
    supplyPrefix?: string;
    isActive?: boolean;
  }): Promise<Shop> {
    const now = new Date();
    this.sequence += 1;

    const shop: Shop = {
      id: `shop-${this.sequence}`,
      name: input.name,
      wbToken: input.wbToken,
      wbSandboxToken: input.wbSandboxToken ?? null,
      useSandbox: input.useSandbox ?? false,
      isActive: input.isActive ?? true,
      supplyPrefix: input.supplyPrefix ?? "toy_",
      tokenUpdatedAt: now,
      createdAt: now,
      updatedAt: now
    };

    this.getTenantStore(tenantId).set(shop.id, shop);
    return shop;
  }

  async updateShop(tenantId: string, input: {
    id: string;
    name?: string;
    wbSandboxToken?: string | null;
    useSandbox?: boolean;
    supplyPrefix?: string;
    isActive?: boolean;
  }): Promise<Shop> {
    const shop = this.getTenantStore(tenantId).get(input.id);

    if (!shop) {
      throw new TestShopNotFoundError(input.id);
    }

    const updated: Shop = {
      ...shop,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.wbSandboxToken === undefined ? {} : { wbSandboxToken: input.wbSandboxToken }),
      ...(input.useSandbox === undefined ? {} : { useSandbox: input.useSandbox }),
      ...(input.supplyPrefix === undefined ? {} : { supplyPrefix: input.supplyPrefix }),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      updatedAt: new Date()
    };

    this.getTenantStore(tenantId).set(input.id, updated);
    return updated;
  }

  async updateShopToken(tenantId: string, input: {
    id: string;
    wbToken: string;
    tokenType?: "production" | "sandbox";
  }): Promise<Shop> {
    const shop = this.getTenantStore(tenantId).get(input.id);

    if (!shop) {
      throw new TestShopNotFoundError(input.id);
    }

    const now = new Date();
    const updated: Shop =
      input.tokenType === "sandbox"
        ? {
            ...shop,
            wbSandboxToken: input.wbToken,
            updatedAt: now
          }
        : {
            ...shop,
            wbToken: input.wbToken,
            tokenUpdatedAt: now,
            updatedAt: now
          };

    this.getTenantStore(tenantId).set(input.id, updated);
    return updated;
  }

  async deactivateShop(tenantId: string, shopId: string): Promise<Shop> {
    const shop = this.getTenantStore(tenantId).get(shopId);

    if (!shop) {
      throw new TestShopNotFoundError(shopId);
    }

    const updated: Shop = {
      ...shop,
      isActive: false,
      updatedAt: new Date()
    };

    this.getTenantStore(tenantId).set(shopId, updated);
    return updated;
  }

  private readTenantShops(tenantId: string): Shop[] {
    return [...this.getTenantStore(tenantId).values()];
  }

  private getTenantStore(tenantId: string): Map<string, Shop> {
    const existing = this.shopsByTenant.get(tenantId);

    if (existing) {
      return existing;
    }

    const created = new Map<string, Shop>();
    this.shopsByTenant.set(tenantId, created);
    return created;
  }
}

class RecordingFlowsService implements BackendFlowsService {
  readonly processCalls: string[] = [];
  readonly syncCalls: string[] = [];
  readonly combinedStartCalls: Array<{ tenantId: string; chatId: number }> = [];
  readonly combinedStatusCalls: string[] = [];

  async processAllShops(tenantId: string) {
    this.processCalls.push(tenantId);

    return {
      startedAt: new Date("2026-01-01T00:00:00.000Z"),
      finishedAt: new Date("2026-01-01T00:00:01.000Z"),
      processedShops: 0,
      successCount: 0,
      skippedCount: 0,
      failureCount: 0,
      results: []
    };
  }

  async syncContentShops(tenantId: string) {
    this.syncCalls.push(tenantId);

    return {
      startedAt: new Date("2026-01-01T00:00:00.000Z"),
      finishedAt: new Date("2026-01-01T00:00:01.000Z"),
      processedShops: 0,
      successCount: 0,
      failureCount: 0,
      totalCardsUpserted: 0,
      results: []
    };
  }

  async startCombinedPdfListsJob(tenantId: string, chatId: number, _languageCode: string | null) {
    this.combinedStartCalls.push({ tenantId, chatId });

    return {
      jobId: "job-1",
      status: "queued" as const,
      createdAt: new Date("2026-01-01T00:00:00.000Z")
    };
  }

  async getCombinedPdfListsJob(tenantId: string, _jobId: string) {
    this.combinedStatusCalls.push(tenantId);

    return {
      jobId: "job-1",
      status: "running" as const,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      startedAt: new Date("2026-01-01T00:00:01.000Z"),
      finishedAt: null,
      error: null,
      result: null
    };
  }
}

function createTelegramHeaders(input: {
  chatId: number;
  chatType: TelegramChatType;
  requesterTelegramUserId: number;
  ownerTelegramUserId: number;
}): Record<string, string> {
  return {
    "x-telegram-chat-id": String(input.chatId),
    "x-telegram-chat-type": input.chatType,
    "x-telegram-user-id": String(input.requesterTelegramUserId),
    "x-telegram-owner-user-id": String(input.ownerTelegramUserId)
  };
}
