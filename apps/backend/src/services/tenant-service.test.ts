import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  listTenants: vi.fn(),
  getOrCreateByOwnerTelegramUserId: vi.fn(),
  upsertTenantChat: vi.fn()
}));

vi.mock("@wb-automation-v2/db", async () => {
  return {
    getDatabase: () => ({ id: "db" }),
    createTenantRepository: () => ({
      listTenants: testState.listTenants,
      getOrCreateByOwnerTelegramUserId: testState.getOrCreateByOwnerTelegramUserId
    }),
    createTenantChatRepository: () => ({
      upsert: testState.upsertTenantChat
    })
  };
});

import { createBackendTenantService } from "./tenant-service.js";

describe("backend tenant service", () => {
  beforeEach(() => {
    testState.listTenants.mockReset();
    testState.getOrCreateByOwnerTelegramUserId.mockReset();
    testState.upsertTenantChat.mockReset();
  });

  it("lists tenant contexts with owner telegram IDs", async () => {
    testState.listTenants.mockResolvedValue([
      { id: "tenant-1", ownerTelegramUserId: 100 },
      { id: "tenant-2", ownerTelegramUserId: 200 }
    ]);

    const service = createBackendTenantService();
    const contexts = await service.listTenantContexts();

    expect(contexts).toEqual([
      { tenantId: "tenant-1", ownerTelegramUserId: 100 },
      { tenantId: "tenant-2", ownerTelegramUserId: 200 }
    ]);
  });

  it("resolves tenant context by owner and upserts tenant chat mapping", async () => {
    testState.getOrCreateByOwnerTelegramUserId.mockResolvedValue({
      id: "tenant-555"
    });

    const service = createBackendTenantService();
    const context = await service.resolveTenantContext({
      chatId: 321,
      chatType: "group",
      requesterTelegramUserId: 777,
      ownerTelegramUserId: 555,
      languageCode: "ru"
    });

    expect(testState.getOrCreateByOwnerTelegramUserId).toHaveBeenCalledWith(555);
    expect(testState.upsertTenantChat).toHaveBeenCalledWith({
      chatId: 321,
      tenantId: "tenant-555",
      ownerTelegramUserId: 555,
      chatType: "group"
    });
    expect(context).toEqual({
      chatId: 321,
      chatType: "group",
      requesterTelegramUserId: 777,
      ownerTelegramUserId: 555,
      languageCode: "ru",
      tenantId: "tenant-555"
    });
  });
});
