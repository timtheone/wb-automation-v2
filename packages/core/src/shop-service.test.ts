import { describe, expect, it, vi } from "vitest";

import {
  createShopService,
  ShopNotFoundError,
  type CreateShopInput,
  type Shop,
  type ShopRepository
} from "./index.js";

const testState = vi.hoisted(() => {
  return {
    shops: null as ShopRepository | null
  };
});

vi.mock("@wb-automation-v2/db", async () => {
  return {
    createShopRepository: () => {
      if (!testState.shops) {
        throw new Error("Shop repository mock is not configured");
      }

      return testState.shops;
    }
  };
});

class InMemoryShopRepository implements ShopRepository {
  private shops: Shop[] = [];

  async listShops(): Promise<Shop[]> {
    return [...this.shops];
  }

  async listActiveShops(): Promise<Shop[]> {
    return this.shops.filter((shop) => shop.isActive);
  }

  async getShopById(id: string): Promise<Shop | null> {
    return this.shops.find((shop) => shop.id === id) ?? null;
  }

  async createShop(input: CreateShopInput): Promise<Shop> {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const shop: Shop = {
      id: `shop-${this.shops.length + 1}`,
      name: input.name,
      wbToken: input.wbToken,
      wbSandboxToken: input.wbSandboxToken ?? null,
      useSandbox: input.useSandbox ?? false,
      isActive: input.isActive ?? true,
      supplyPrefix: input.supplyPrefix ?? "игрушки_",
      tokenUpdatedAt: now,
      createdAt: now,
      updatedAt: now
    };

    this.shops.push(shop);

    return shop;
  }

  async updateShop(id: string, patch: {
    name?: string;
    wbSandboxToken?: string | null;
    useSandbox?: boolean;
    supplyPrefix?: string;
    isActive?: boolean;
  }) {
    const shop = this.shops.find((item) => item.id === id);

    if (!shop) {
      return null;
    }

    Object.assign(shop, patch, { updatedAt: new Date("2026-01-02T00:00:00.000Z") });

    return shop;
  }

  async updateShopToken(id: string, wbToken: string, tokenUpdatedAt: Date, tokenType = "production") {
    const shop = this.shops.find((item) => item.id === id);

    if (!shop) {
      return null;
    }

    if (tokenType === "sandbox") {
      shop.wbSandboxToken = wbToken;
    } else {
      shop.wbToken = wbToken;
      shop.tokenUpdatedAt = tokenUpdatedAt;
    }

    shop.updatedAt = tokenUpdatedAt;

    return shop;
  }

  async deactivateShop(id: string) {
    return this.updateShop(id, { isActive: false });
  }
}

describe("shop service", () => {
  it("creates, updates token and deactivates shop", async () => {
    testState.shops = new InMemoryShopRepository();
    const fixedNow = new Date("2026-02-01T10:00:00.000Z");
    const service = createShopService({
      now: () => fixedNow
    });

    const created = await service.createShop({
      name: "  Main Shop  ",
      wbToken: " token-1 "
    });

    expect(created.name).toBe("Main Shop");
    expect(created.wbToken).toBe("token-1");

    const tokenUpdated = await service.updateShopToken({
      id: created.id,
      wbToken: "token-2"
    });

    expect(tokenUpdated.wbToken).toBe("token-2");
    expect(tokenUpdated.tokenUpdatedAt.toISOString()).toBe(fixedNow.toISOString());

    const deactivated = await service.deactivateShop(created.id);

    expect(deactivated.isActive).toBe(false);
  });

  it("updates sandbox token when tokenType is sandbox", async () => {
    testState.shops = new InMemoryShopRepository();
    const service = createShopService();

    const created = await service.createShop({
      name: "Sandbox Shop",
      wbToken: "prod-token"
    });

    const updated = await service.updateShopToken({
      id: created.id,
      wbToken: "sandbox-token",
      tokenType: "sandbox"
    });

    expect(updated.wbToken).toBe("prod-token");
    expect(updated.wbSandboxToken).toBe("sandbox-token");
  });

  it("throws not found when updating missing shop", async () => {
    testState.shops = new InMemoryShopRepository();
    const service = createShopService();

    await expect(
      service.updateShop({
        id: "missing",
        name: "new"
      })
    ).rejects.toBeInstanceOf(ShopNotFoundError);
  });

  it("rejects enabling sandbox without sandbox token", async () => {
    testState.shops = new InMemoryShopRepository();
    const service = createShopService();

    await expect(
      service.createShop({
        name: "Sandbox Shop",
        wbToken: "prod-token",
        useSandbox: true
      })
    ).rejects.toThrow("wbSandboxToken must be provided when useSandbox is true");
  });
});
