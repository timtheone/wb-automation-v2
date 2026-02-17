import { createShopService, type ShopService } from "@wb-automation-v2/core";

export type BackendShopsService = ShopService;

export function createBackendShopsService(): BackendShopsService {
  return createShopService();
}
