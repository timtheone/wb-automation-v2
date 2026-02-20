import createClient from "openapi-fetch";

import type { paths } from "./generated/backend-schema";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface ResponseLike {
  status: number;
  statusText: string;
  url: string;
  headers: {
    get(name: string): string | null;
  };
  json(): Promise<unknown>;
  text(): Promise<string>;
  clone(): ResponseLike;
}

export interface CreateBackendClientOptions {
  baseUrl: string;
  fetch?: FetchLike;
}

export class BackendApiHttpError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly url: string;
  readonly details: unknown;

  constructor(response: ResponseLike, details: unknown) {
    const url = response.url || "unknown endpoint";
    super(resolveErrorMessage(details, response.status, url));
    this.name = "BackendApiHttpError";
    this.status = response.status;
    this.statusText = response.statusText;
    this.url = url;
    this.details = details;
  }
}

export function createBackendClient(options: CreateBackendClientOptions) {
  const client = createClient<paths>({
    baseUrl: normalizeBaseUrl(options.baseUrl),
    fetch: options.fetch
  });

  client.use({
    onRequest({ request }) {
      request.headers.set("Accept", "application/json");
    },
    async onResponse({ response }) {
      if (response.ok) {
        return;
      }

      const details = await parseResponsePayload(response.clone());
      throw new BackendApiHttpError(response, details);
    }
  });

  return client;
}

export type BackendClient = ReturnType<typeof createBackendClient>;
export type BackendPaths = paths;

async function parseResponsePayload(response: ResponseLike): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

  if (contentType.includes("application/json")) {
    return response.json();
  }

  const text = await response.text();
  return text.length > 0 ? text : null;
}

function resolveErrorMessage(details: unknown, statusCode: number, url: string): string {
  if (details && typeof details === "object" && "error" in details) {
    const error = details.error;

    if (typeof error === "string" && error.length > 0) {
      return error;
    }
  }

  return `Backend request failed (status ${statusCode}, url ${url})`;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}
