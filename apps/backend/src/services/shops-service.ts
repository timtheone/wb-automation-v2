import {
  createShopService,
  type CreateShopInput,
  type Shop,
  type UpdateShopInput,
  type UpdateShopTokenInput
} from "@wb-automation-v2/core";
import { getDatabase } from "@wb-automation-v2/db";

export interface BackendShopsService {
  listShops(tenantId: string): Promise<Shop[]>;
  createShop(tenantId: string, input: CreateShopInput): Promise<Shop>;
  updateShop(tenantId: string, input: UpdateShopInput): Promise<Shop>;
  updateShopToken(tenantId: string, input: UpdateShopTokenInput): Promise<Shop>;
  deactivateShop(tenantId: string, shopId: string): Promise<Shop>;
}

export function createBackendShopsService(): BackendShopsService {
  const db = getDatabase();

  return {
    listShops(tenantId) {
      return createShopService({ tenantId, db }).listShops();
    },
    createShop(tenantId, input) {
      return createShopService({ tenantId, db }).createShop(input);
    },
    updateShop(tenantId, input) {
      return createShopService({ tenantId, db }).updateShop(input);
    },
    updateShopToken(tenantId, input) {
      return createShopService({ tenantId, db }).updateShopToken(input);
    },
    deactivateShop(tenantId, shopId) {
      return createShopService({ tenantId, db }).deactivateShop(shopId);
    }
  };
}
