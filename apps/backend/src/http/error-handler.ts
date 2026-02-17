import type { Context } from "hono";
import { ShopNotFoundError, toErrorMessage } from "@wb-automation-v2/core";
import type { Logger } from "pino";

import { RequestValidationError } from "./validation.js";

export type RouteErrorHandler = (c: Context, error: unknown) => Response;

export function createRouteErrorHandler(logger: Logger): RouteErrorHandler {
  return (c, error) => {
    if (error instanceof RequestValidationError) {
      return c.json(
        {
          error: error.message,
          details: error.details
        },
        400
      );
    }

    if (error instanceof ShopNotFoundError) {
      return c.json({ error: error.message }, 404);
    }

    if (isUniqueViolation(error)) {
      return c.json({ error: "Shop with this name already exists" }, 409);
    }

    logger.error(
      {
        method: c.req.method,
        path: c.req.path,
        error: toErrorMessage(error)
      },
      "request failed"
    );

    return c.json({ error: "Internal server error" }, 500);
  };
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const code = (error as { code?: unknown }).code;
  return code === "23505";
}
