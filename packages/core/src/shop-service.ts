import {
  createShopRepository,
  type CreateShopInput,
  type Shop,
  type UpdateShopInput,
  type UpdateShopTokenInput
} from "@wb-automation-v2/db";

export class ShopNotFoundError extends Error {
  constructor(shopId: string) {
    super(`Shop not found: ${shopId}`);
    this.name = "ShopNotFoundError";
  }
}

export interface ShopService {
  listShops(): Promise<Shop[]>;
  createShop(input: CreateShopInput): Promise<Shop>;
  updateShop(input: UpdateShopInput): Promise<Shop>;
  updateShopToken(input: UpdateShopTokenInput): Promise<Shop>;
  deactivateShop(shopId: string): Promise<Shop>;
}

export function createShopService(options: { now?: () => Date } = {}): ShopService {
  const now = options.now ?? (() => new Date());
  const shops = createShopRepository();

  return {
    async listShops() {
      return shops.listShops();
    },

    async createShop(input) {
      const name = normalizeRequiredString(input.name, "name");
      const wbToken = normalizeRequiredString(input.wbToken, "wbToken");
      const supplyPrefix = normalizeOptionalString(input.supplyPrefix) ?? "игрушки_";

      return shops.createShop({
        name,
        wbToken,
        supplyPrefix,
        isActive: input.isActive ?? true
      });
    },

    async updateShop(input) {
      const patch = {
        ...(input.name === undefined ? {} : { name: normalizeRequiredString(input.name, "name") }),
        ...(input.supplyPrefix === undefined
          ? {}
          : { supplyPrefix: normalizeRequiredString(input.supplyPrefix, "supplyPrefix") }),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive })
      };

      const updated = await shops.updateShop(input.id, patch);

      if (!updated) {
        throw new ShopNotFoundError(input.id);
      }

      return updated;
    },

    async updateShopToken(input) {
      const wbToken = normalizeRequiredString(input.wbToken, "wbToken");
      const updated = await shops.updateShopToken(input.id, wbToken, now());

      if (!updated) {
        throw new ShopNotFoundError(input.id);
      }

      return updated;
    },

    async deactivateShop(shopId) {
      const updated = await shops.deactivateShop(shopId);

      if (!updated) {
        throw new ShopNotFoundError(shopId);
      }

      return updated;
    }
  };
}

function normalizeRequiredString(value: string, field: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${field} must not be empty`);
  }

  return normalized;
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim();

  return normalized || undefined;
}
