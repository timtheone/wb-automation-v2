import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  getDatabase: vi.fn(),
  createShopService: vi.fn()
}));

vi.mock("@wb-automation-v2/db", async () => {
  return {
    getDatabase: testState.getDatabase
  };
});

vi.mock("@wb-automation-v2/core", async () => {
  return {
    createShopService: testState.createShopService
  };
});

import { createBackendShopsService } from "./shops-service.js";

describe("backend shops service", () => {
  beforeEach(() => {
    testState.getDatabase.mockReset();
    testState.createShopService.mockReset();

    testState.getDatabase.mockReturnValue({ name: "db" });
    testState.createShopService.mockImplementation(({ tenantId }: { tenantId: string }) => ({
      listShops: vi.fn(async () => [{ id: `shop-for-${tenantId}` }]),
      createShop: vi.fn(async (input) => ({ id: `created-${tenantId}`, ...input })),
      updateShop: vi.fn(async (input) => ({ id: input.id, ...input })),
      updateShopToken: vi.fn(async (input) => ({ id: input.id, ...input })),
      deactivateShop: vi.fn(async (shopId) => ({ id: shopId, isActive: false }))
    }));
  });

  it("creates tenant-scoped core shop service per call", async () => {
    const service = createBackendShopsService();

    const listed = await service.listShops("tenant-a");
    const created = await service.createShop("tenant-a", {
      name: "Shop A",
      wbToken: "token-a"
    });

    expect(listed).toEqual([{ id: "shop-for-tenant-a" }]);
    expect(created).toMatchObject({ id: "created-tenant-a", name: "Shop A" });

    expect(testState.createShopService).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      db: { name: "db" }
    });
  });

  it("delegates token update and deactivation to core service", async () => {
    const service = createBackendShopsService();

    const updated = await service.updateShopToken("tenant-b", {
      id: "shop-1",
      wbToken: "new-token",
      tokenType: "production"
    });
    const deactivated = await service.deactivateShop("tenant-b", "shop-1");

    expect(updated).toMatchObject({ id: "shop-1", wbToken: "new-token" });
    expect(deactivated).toMatchObject({ id: "shop-1", isActive: false });
  });
});
