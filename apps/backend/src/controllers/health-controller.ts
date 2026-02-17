import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";

const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("backend")
}).openapi("HealthResponse");

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  tags: ["Health"],
  responses: {
    200: {
      description: "Service health status",
      content: {
        "application/json": {
          schema: healthResponseSchema
        }
      }
    }
  }
});

export function registerHealthController(app: OpenAPIHono) {
  app.openapi(healthRoute, (c) => {
    return c.json({
      status: "ok",
      service: "backend"
    });
  });
}
