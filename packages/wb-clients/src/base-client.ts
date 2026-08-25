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

export class WbApiTransportError extends Error {
  readonly method: string;
  readonly url: string;

  constructor(method: string, url: string, cause: unknown) {
    super(`WB API transport failed (${method} ${url}): ${formatTransportCause(cause)}`, { cause });
    this.name = "WbApiTransportError";
    this.method = method;
    this.url = url;
  }
}

export function createWbBaseClient<TPaths extends object>(options: CreateWbBaseClientOptions) {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const client = createClient<TPaths>({
    baseUrl: normalizeBaseUrl(options.baseUrl),
    fetch: async (request: Request) => {
      try {
        return await fetchImplementation(request);
      } catch (error) {
        throw new WbApiTransportError(request.method, request.url, error);
      }
    }
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

function formatTransportCause(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error ? error.cause : undefined;
  const causeMessage = cause instanceof Error ? cause.message : undefined;
  const code = readErrorCode(cause) ?? readErrorCode(error);

  if (causeMessage && code !== undefined) {
    return `${message} (cause: ${causeMessage}; code: ${code})`;
  }

  if (causeMessage) {
    return `${message} (cause: ${causeMessage})`;
  }

  return code === undefined ? message : `${message} (code: ${code})`;
}

function readErrorCode(error: unknown): string | number | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const code = (error as { code?: unknown }).code;

  return typeof code === "string" || typeof code === "number" ? code : undefined;
}
