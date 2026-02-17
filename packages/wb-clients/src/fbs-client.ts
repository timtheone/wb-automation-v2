import {
  createWbBaseClient,
  type FetchLike
} from "./base-client.js";
import type { paths as FbsPaths } from "./generated/fbs-schema";

export const WB_FBS_API_BASE_URL = "https://marketplace-api.wildberries.ru";
export const WB_FBS_SANDBOX_API_BASE_URL = "https://marketplace-api-sandbox.wildberries.ru";

export interface CreateWbFbsClientOptions {
  token: string;
  fetch?: FetchLike;
  baseUrl?: string;
}

export function createWbFbsClient(options: CreateWbFbsClientOptions) {
  return createWbBaseClient<FbsPaths>({
    token: options.token,
    fetch: options.fetch,
    baseUrl: options.baseUrl ?? WB_FBS_API_BASE_URL
  });
}

export type WbFbsClient = ReturnType<typeof createWbFbsClient>;
