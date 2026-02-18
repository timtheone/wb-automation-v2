import type { Context } from "hono";
import { z } from "zod";

export class RequestValidationError extends Error {
  readonly code: string;

  constructor(
    message: string,
    public readonly details: unknown = null,
    code = "REQUEST_VALIDATION_FAILED"
  ) {
    super(message);
    this.name = "RequestValidationError";
    this.code = code;
  }
}

export async function parseJsonBody<TSchema extends z.ZodType>(
  c: Context,
  schema: TSchema
): Promise<z.infer<TSchema>> {
  let body: unknown;

  try {
    body = await c.req.json();
  } catch {
    throw new RequestValidationError("Request body must be valid JSON", null, "REQUEST_BODY_INVALID_JSON");
  }

  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    throw new RequestValidationError("Invalid request body", parsed.error.flatten(), "REQUEST_BODY_INVALID");
  }

  return parsed.data;
}
