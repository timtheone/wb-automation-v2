import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";

import { registerFlowsController } from "./controllers/flows-controller.js";
import { registerHealthController } from "./controllers/health-controller.js";
import { registerShopsController } from "./controllers/shops-controller.js";
import { createRouteErrorHandler } from "./http/error-handler.js";
import { createLogger } from "./logger.js";
import { backendOpenApiDocument } from "./openapi/document.js";
import { createBackendServices } from "./services/index.js";

export function createApp() {
  const app = new OpenAPIHono();
  const logger = createLogger({ component: "http" });
  const services = createBackendServices();
  const handleRouteError = createRouteErrorHandler(logger);

  app.use("*", async (c, next) => {
    const startedAtMs = Date.now();
    await next();

    logger.info(
      {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Date.now() - startedAtMs
      },
      "request completed"
    );
  });

  registerHealthController(app);
  registerShopsController(app, {
    shopsService: services.shopsService,
    handleRouteError
  });
  registerFlowsController(app, {
    flowsService: services.flowsService,
    handleRouteError
  });

  app.doc("/openapi.json", backendOpenApiDocument);

  app.get("/docs", swaggerUI({ url: "/openapi.json" }));

  return { app, logger };
}
