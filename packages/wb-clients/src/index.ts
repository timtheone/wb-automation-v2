export {
  createWbFbsClient,
  WB_FBS_API_BASE_URL,
  type CreateWbFbsClientOptions,
  type WbFbsClient
} from "./fbs-client.js";
export {
  createWbBaseClient,
  type CreateWbBaseClientOptions,
  type FetchLike
} from "./base-client.js";
export {
  createWbProductsClient,
  WB_PRODUCTS_API_BASE_URL,
  type CreateWbProductsClientOptions,
  type WbProductsClient
} from "./products-client.js";
export type { paths as FbsPaths } from "./generated/fbs-schema";
export type { paths as ProductsPaths } from "./generated/products-schema";
