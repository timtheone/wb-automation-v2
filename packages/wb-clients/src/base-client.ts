import createClient from "openapi-fetch";

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export interface CreateWbBaseClientOptions {
  token: string;
  fetch?: FetchLike;
  baseUrl: string;
}

export function createWbBaseClient<TPaths extends object>(
  options: CreateWbBaseClientOptions
) {
  const client = createClient<TPaths>({
    baseUrl: normalizeBaseUrl(options.baseUrl),
    fetch: options.fetch
  });

  client.use({
    onRequest({ request }) {
      request.headers.set("Authorization", options.token);
      request.headers.set("Accept", "application/json");
      return request;
    }
  });

  return client;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}
