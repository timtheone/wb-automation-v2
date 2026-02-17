import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";

import type { RouteErrorHandler } from "../http/error-handler.js";
import {
  errorResponseSchema,
  notImplementedResponseSchema,
  processAllShopsResultSchema,
  syncContentShopsResultSchema
} from "../openapi/schemas.js";
import type { BackendFlowsService } from "../services/flows-service.js";

const processAllShopsRoute = createRoute({
  method: "post",
  path: "/flows/process-all-shops",
  tags: ["Flows"],
  responses: {
    200: {
      description: "Process all active shops",
      content: {
        "application/json": {
          schema: processAllShopsResultSchema
        }
      }
    },
    500: {
      description: "Internal server error",
      content: {
        "application/json": {
          schema: errorResponseSchema
        }
      }
    }
  }
});

const syncContentShopsRoute = createRoute({
  method: "post",
  path: "/flows/sync-content-shops",
  tags: ["Flows"],
  responses: {
    200: {
      description: "Sync product cards for all active shops",
      content: {
        "application/json": {
          schema: syncContentShopsResultSchema
        }
      }
    },
    500: {
      description: "Internal server error",
      content: {
        "application/json": {
          schema: errorResponseSchema
        }
      }
    }
  }
});

const getCombinedPdfListsRoute = createRoute({
  method: "post",
  path: "/flows/get-combined-pdf-lists",
  tags: ["Flows"],
  responses: {
    501: {
      description: "Flow is not implemented",
      content: {
        "application/json": {
          schema: notImplementedResponseSchema
        }
      }
    }
  }
});

const getWaitingOrdersPdfRoute = createRoute({
  method: "post",
  path: "/flows/get-waiting-orders-pdf",
  tags: ["Flows"],
  responses: {
    501: {
      description: "Flow is not implemented",
      content: {
        "application/json": {
          schema: notImplementedResponseSchema
        }
      }
    }
  }
});

export function registerFlowsController(
  app: OpenAPIHono,
  dependencies: {
    flowsService: BackendFlowsService;
    handleRouteError: RouteErrorHandler;
  }
) {
  app.openapi(processAllShopsRoute, async (c) => {
    try {
      const result = await dependencies.flowsService.processAllShops();
      return c.json(result, 200);
    } catch (error) {
      return dependencies.handleRouteError(c, error) as never;
    }
  });

  app.openapi(syncContentShopsRoute, async (c) => {
    try {
      const result = await dependencies.flowsService.syncContentShops();
      return c.json(result, 200);
    } catch (error) {
      return dependencies.handleRouteError(c, error) as never;
    }
  });

  app.openapi(getCombinedPdfListsRoute, (c) => {
    return c.json(
      {
        error: "Flow get_combined_pdf_lists is not implemented yet"
      },
      501
    );
  });

  app.openapi(getWaitingOrdersPdfRoute, (c) => {
    return c.json(
      {
        error: "Flow get_waiting_orders_pdf is not implemented yet"
      },
      501
    );
  });
}
