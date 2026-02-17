import {
  createShopRepository,
  type CreateShopInput,
  type Shop,
  type WbTokenType,
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
      const wbSandboxToken = normalizeNullableOptionalString(input.wbSandboxToken, "wbSandboxToken");
      const useSandbox = input.useSandbox ?? false;
      const supplyPrefix = normalizeOptionalString(input.supplyPrefix) ?? "игрушки_";

      assertSandboxConfiguration({
        useSandbox,
        wbSandboxToken: wbSandboxToken ?? null
      });

      return shops.createShop({
        name,
        wbToken,
        wbSandboxToken,
        useSandbox,
        supplyPrefix,
        isActive: input.isActive ?? true
      });
    },

    async updateShop(input) {
      let normalizedSandboxToken: string | null | undefined;
      let normalizedUseSandbox: boolean | undefined;

      if (input.wbSandboxToken !== undefined || input.useSandbox !== undefined) {
        const existing = await shops.getShopById(input.id);

        if (!existing) {
          throw new ShopNotFoundError(input.id);
        }

        normalizedSandboxToken = normalizeNullableOptionalString(input.wbSandboxToken, "wbSandboxToken");
        normalizedUseSandbox = input.useSandbox;

        const effectiveUseSandbox = normalizedUseSandbox ?? existing.useSandbox;
        const effectiveSandboxToken =
          normalizedSandboxToken === undefined ? existing.wbSandboxToken : normalizedSandboxToken;

        assertSandboxConfiguration({
          useSandbox: effectiveUseSandbox,
          wbSandboxToken: effectiveSandboxToken
        });
      }

      const patch = {
        ...(input.name === undefined ? {} : { name: normalizeRequiredString(input.name, "name") }),
        ...(normalizedSandboxToken === undefined ? {} : { wbSandboxToken: normalizedSandboxToken }),
        ...(normalizedUseSandbox === undefined ? {} : { useSandbox: normalizedUseSandbox }),
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
      const tokenType = normalizeTokenType(input.tokenType);
      const updated = await shops.updateShopToken(input.id, wbToken, now(), tokenType);

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

function normalizeNullableOptionalString(
  value: string | null | undefined,
  field: string
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${field} must not be empty`);
  }

  return normalized;
}

function normalizeTokenType(tokenType: WbTokenType | undefined): WbTokenType {
  return tokenType ?? "production";
}

function assertSandboxConfiguration(input: {
  useSandbox: boolean;
  wbSandboxToken: string | null;
}) {
  if (input.useSandbox && !input.wbSandboxToken) {
    throw new Error("wbSandboxToken must be provided when useSandbox is true");
  }
}
