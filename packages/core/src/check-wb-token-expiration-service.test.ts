import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createCheckWbTokenExpirationService,
  type Shop,
  type ShopRepository
} from "./index.js";

const testState = vi.hoisted(() => {
  return {
    shops: null as Pick<ShopRepository, "listShops"> | null
  };
});

vi.mock("@wb-automation-v2/db", async () => {
  return {
    createDbRepositories: () => {
      if (!testState.shops) {
        throw new Error("DB repositories mock is not configured");
      }

      return {
        shops: testState.shops,
        productCards: {} as never,
        syncState: {} as never
      };
    }
  };
});

describe("check wb token expiration service", () => {
  beforeEach(() => {
    testState.shops = null;
  });

  it("returns warnings for tokens expiring within threshold", async () => {
    testState.shops = {
      async listShops() {
        return [
          createShop({ id: "shop-1", name: "Soon", wbToken: createJwtWithExp("2026-02-22T12:00:00.000Z") }),
          createShop({ id: "shop-2", name: "Later", wbToken: createJwtWithExp("2026-03-01T12:00:00.000Z") })
        ];
      }
    };

    const service = createCheckWbTokenExpirationService({
      tenantId: "tenant-1",
      warningThresholdDays: 4,
      now: () => new Date("2026-02-19T12:00:00.000Z")
    });

    const result = await service.checkWbTokenExpiration();

    expect(result.processedShops).toBe(2);
    expect(result.warnings).toEqual([
      {
        shopId: "shop-1",
        shopName: "Soon",
        tokenType: "production",
        expiresAt: new Date("2026-02-22T12:00:00.000Z"),
        daysLeft: 3
      }
    ]);
    expect(result.invalidTokens).toEqual([]);
    expect(result.expiredTokensCount).toBe(0);
  });

  it("tracks invalid and expired tokens separately", async () => {
    testState.shops = {
      async listShops() {
        return [
          createShop({ id: "shop-bad", name: "Bad", wbToken: "not-a-jwt" }),
          createShop({ id: "shop-old", name: "Old", wbToken: createJwtWithExp("2026-02-10T12:00:00.000Z") })
        ];
      }
    };

    const service = createCheckWbTokenExpirationService({
      tenantId: "tenant-1",
      warningThresholdDays: 4,
      now: () => new Date("2026-02-19T12:00:00.000Z")
    });

    const result = await service.checkWbTokenExpiration();

    expect(result.warnings).toEqual([]);
    expect(result.invalidTokens).toEqual([
      {
        shopId: "shop-bad",
        shopName: "Bad",
        tokenType: "production",
        reason: "token is not a JWT"
      }
    ]);
    expect(result.expiredTokensCount).toBe(1);
  });
});

function createJwtWithExp(expiresAtIso: string): string {
  const header = toBase64Url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const payload = toBase64Url(
    JSON.stringify({
      exp: Math.floor(new Date(expiresAtIso).getTime() / 1_000)
    })
  );
  return `${header}.${payload}.signature`;
}

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=/gu, "");
}

function createShop(overrides: Partial<Shop>): Shop {
  return {
    id: "shop-1",
    name: "Shop One",
    wbToken: "token-1",
    wbSandboxToken: null,
    useSandbox: false,
    isActive: true,
    supplyPrefix: "игрушки_",
    tokenUpdatedAt: new Date("2026-01-01T00:00:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides
  };
}
