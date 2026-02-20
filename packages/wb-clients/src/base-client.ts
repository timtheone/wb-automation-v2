import createClient from "openapi-fetch";

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface CreateWbBaseClientOptions {
  token: string;
  fetch?: FetchLike;
  baseUrl: string;
}

export class WbApiHttpError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly url: string;

  constructor(response: Response) {
    const url = response.url || "unknown endpoint";
    super(`WB API request failed (status ${response.status}, url ${url})`);
    this.name = "WbApiHttpError";
    this.status = response.status;
    this.statusText = response.statusText;
    this.url = url;
  }
}

export function createWbBaseClient<TPaths extends object>(options: CreateWbBaseClientOptions) {
  const client = createClient<TPaths>({
    baseUrl: normalizeBaseUrl(options.baseUrl),
    fetch: options.fetch
  });

  client.use({
    onRequest({ request }) {
      request.headers.set("Authorization", options.token);
      request.headers.set("Accept", "application/json");
    },
    onResponse({ response }) {
      if (!response.ok) {
        throw new WbApiHttpError(response);
      }
    }
  });

  return client;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}
