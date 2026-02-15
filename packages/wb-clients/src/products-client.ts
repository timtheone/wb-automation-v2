import {
  createWbBaseClient,
  type FetchLike
} from "./base-client.js";
import type { paths as ProductsPaths } from "./generated/products-schema";

export const WB_PRODUCTS_API_BASE_URL = "https://content-api.wildberries.ru";

export interface CreateWbProductsClientOptions {
  token: string;
  fetch?: FetchLike;
  baseUrl?: string;
}

export function createWbProductsClient(options: CreateWbProductsClientOptions) {
  return createWbBaseClient<ProductsPaths>({
    token: options.token,
    fetch: options.fetch,
    baseUrl: options.baseUrl ?? WB_PRODUCTS_API_BASE_URL
  });
}

export type WbProductsClient = ReturnType<typeof createWbProductsClient>;
