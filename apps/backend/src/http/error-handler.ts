import type { Context } from "hono";
import { ShopNotFoundError, toErrorMessage } from "@wb-automation-v2/core";
import type { Logger } from "pino";

import { FlowJobNotFoundError } from "../services/flows-service.js";
import { RequestValidationError } from "./validation.js";

export type RouteErrorHandler = (c: Context, error: unknown) => Response;

export function createRouteErrorHandler(logger: Logger): RouteErrorHandler {
  return (c, error) => {
    if (error instanceof RequestValidationError) {
      return c.json(
        {
          code: error.code,
          error: error.message,
          details: error.details
        },
        400
      );
    }

    if (error instanceof ShopNotFoundError) {
      return c.json({ code: "SHOP_NOT_FOUND", error: error.message }, 404);
    }

    if (error instanceof FlowJobNotFoundError) {
      return c.json({ code: "FLOW_JOB_NOT_FOUND", error: error.message }, 404);
    }

    if (isUniqueViolation(error)) {
      return c.json(
        { code: "SHOP_NAME_ALREADY_EXISTS", error: "Shop with this name already exists" },
        409
      );
    }

    logger.error(
      {
        method: c.req.method,
        path: c.req.path,
        error: toErrorMessage(error)
      },
      "request failed"
    );

    return c.json({ code: "INTERNAL_SERVER_ERROR", error: "Internal server error" }, 500);
  };
}

function isUniqueViolation(error: unknown): boolean {
  return hasPostgresCode(error, "23505") || hasPostgresCode(getErrorCause(error), "23505");
}

function hasPostgresCode(error: unknown, code: string): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const errorCode = (error as { code?: unknown }).code;
  return errorCode === code;
}

function getErrorCause(error: unknown): unknown {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  return (error as { cause?: unknown }).cause ?? null;
}
