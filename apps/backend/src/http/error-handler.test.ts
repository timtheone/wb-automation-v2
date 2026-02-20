import { describe, expect, it, vi } from "vitest";

vi.mock("@wb-automation-v2/core", async () => {
  class ShopNotFoundError extends Error {
    constructor(shopId: string) {
      super(`Shop not found: ${shopId}`);
      this.name = "ShopNotFoundError";
    }
  }

  return {
    ShopNotFoundError,
    toErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error))
  };
});

vi.mock("../services/flows-service.js", async () => {
  class FlowJobNotFoundError extends Error {
    constructor(jobId: string) {
      super(`Flow job not found: ${jobId}`);
      this.name = "FlowJobNotFoundError";
    }
  }

  return { FlowJobNotFoundError };
});

import { createRouteErrorHandler } from "./error-handler.js";
import { RequestValidationError } from "./validation.js";
import { ShopNotFoundError } from "@wb-automation-v2/core";
import { FlowJobNotFoundError } from "../services/flows-service.js";

describe("route error handler", () => {
  it("maps request validation errors to 400", async () => {
    const logger = { error: vi.fn() };
    const handler = createRouteErrorHandler(logger as never);

    const response = handler(
      createContext(),
      new RequestValidationError(
        "Invalid request body",
        { fieldErrors: { name: ["required"] } },
        "REQUEST_BODY_INVALID"
      )
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "REQUEST_BODY_INVALID",
      error: "Invalid request body",
      details: { fieldErrors: { name: ["required"] } }
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("maps domain not-found errors to 404", async () => {
    const logger = { error: vi.fn() };
    const handler = createRouteErrorHandler(logger as never);

    const shopResponse = handler(createContext(), new ShopNotFoundError("shop-42"));
    expect(shopResponse.status).toBe(404);
    expect(await shopResponse.json()).toMatchObject({ code: "SHOP_NOT_FOUND" });

    const flowResponse = handler(createContext(), new FlowJobNotFoundError("job-42"));
    expect(flowResponse.status).toBe(404);
    expect(await flowResponse.json()).toMatchObject({ code: "FLOW_JOB_NOT_FOUND" });
  });

  it("maps postgres unique violations to 409", async () => {
    const logger = { error: vi.fn() };
    const handler = createRouteErrorHandler(logger as never);

    const response = handler(createContext(), { code: "23505" });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: "SHOP_NAME_ALREADY_EXISTS",
      error: "Shop with this name already exists"
    });
  });

  it("maps unknown errors to 500 and logs context", async () => {
    const logger = { error: vi.fn() };
    const handler = createRouteErrorHandler(logger as never);

    const response = handler(
      createContext({ method: "PATCH", path: "/shops/s1" }),
      new Error("boom")
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      code: "INTERNAL_SERVER_ERROR",
      error: "Internal server error"
    });
    expect(logger.error).toHaveBeenCalledWith(
      {
        method: "PATCH",
        path: "/shops/s1",
        error: "boom"
      },
      "request failed"
    );
  });
});

function createContext(overrides: { method?: string; path?: string } = {}) {
  return {
    req: {
      method: overrides.method ?? "POST",
      path: overrides.path ?? "/test"
    },
    json(payload: unknown, status: number) {
      return new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" }
      });
    }
  } as never;
}
