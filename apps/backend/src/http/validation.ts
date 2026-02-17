import type { Context } from "hono";
import { z } from "zod";

export class RequestValidationError extends Error {
  constructor(
    message: string,
    public readonly details: unknown = null
  ) {
    super(message);
    this.name = "RequestValidationError";
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
    throw new RequestValidationError("Request body must be valid JSON");
  }

  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    throw new RequestValidationError("Invalid request body", parsed.error.flatten());
  }

  return parsed.data;
}
