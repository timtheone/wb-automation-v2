import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";

import type { RouteErrorHandler } from "../http/error-handler.js";
import { readTelegramRequestContext } from "../http/telegram-context.js";
import { telegramContextHeadersSchema } from "../openapi/telegram-context.js";
import {
  combinedPdfListsJobAcceptedSchema,
  combinedPdfListsJobStatusSchema,
  errorResponseSchema,
  notImplementedResponseSchema,
  processAllShopsResultSchema,
  syncContentShopsResultSchema
} from "../openapi/schemas.js";
import type { BackendFlowsService } from "../services/flows-service.js";
import type { BackendTenantService } from "../services/tenant-service.js";

const processAllShopsRoute = createRoute({
  method: "post",
  path: "/flows/process-all-shops",
  tags: ["Flows"],
  request: {
    headers: telegramContextHeadersSchema
  },
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
  request: {
    headers: telegramContextHeadersSchema
  },
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
  request: {
    headers: telegramContextHeadersSchema
  },
  responses: {
    202: {
      description: "Start combined PDF generation job",
      content: {
        "application/json": {
          schema: combinedPdfListsJobAcceptedSchema
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

const getCombinedPdfListsJobRoute = createRoute({
  method: "get",
  path: "/flows/get-combined-pdf-lists/{jobId}",
  tags: ["Flows"],
  request: {
    headers: telegramContextHeadersSchema,
    params: z.object({
      jobId: z.string()
    })
  },
  responses: {
    200: {
      description: "Get combined PDF generation job status",
      content: {
        "application/json": {
          schema: combinedPdfListsJobStatusSchema
        }
      }
    },
    404: {
      description: "Flow job not found",
      content: {
        "application/json": {
          schema: errorResponseSchema
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

const getWaitingOrdersPdfRoute = createRoute({
  method: "post",
  path: "/flows/get-waiting-orders-pdf",
  tags: ["Flows"],
  request: {
    headers: telegramContextHeadersSchema
  },
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
    tenantService: BackendTenantService;
    handleRouteError: RouteErrorHandler;
  }
) {
  app.openapi(processAllShopsRoute, async (c) => {
    try {
      const tenantContext = await dependencies.tenantService.resolveTenantContext(
        readTelegramRequestContext(c)
      );
      const result = await dependencies.flowsService.processAllShops(tenantContext.tenantId);
      return c.json(result, 200);
    } catch (error) {
      return dependencies.handleRouteError(c, error) as never;
    }
  });

  app.openapi(syncContentShopsRoute, async (c) => {
    try {
      const tenantContext = await dependencies.tenantService.resolveTenantContext(
        readTelegramRequestContext(c)
      );
      const result = await dependencies.flowsService.syncContentShops(tenantContext.tenantId);
      return c.json(result, 200);
    } catch (error) {
      return dependencies.handleRouteError(c, error) as never;
    }
  });

  app.openapi(getCombinedPdfListsRoute, async (c) => {
    try {
      const telegramContext = readTelegramRequestContext(c);
      const tenantContext = await dependencies.tenantService.resolveTenantContext(telegramContext);
      const result = await dependencies.flowsService.startCombinedPdfListsJob(
        tenantContext.tenantId,
        telegramContext.chatId,
        telegramContext.languageCode ?? null
      );
      return c.json(result, 202);
    } catch (error) {
      return dependencies.handleRouteError(c, error) as never;
    }
  });

  app.openapi(getCombinedPdfListsJobRoute, async (c) => {
    try {
      const tenantContext = await dependencies.tenantService.resolveTenantContext(
        readTelegramRequestContext(c)
      );
      const result = await dependencies.flowsService.getCombinedPdfListsJob(
        tenantContext.tenantId,
        c.req.valid("param").jobId
      );
      return c.json(result, 200);
    } catch (error) {
      return dependencies.handleRouteError(c, error) as never;
    }
  });

  app.openapi(getWaitingOrdersPdfRoute, async (c) => {
    try {
      await dependencies.tenantService.resolveTenantContext(readTelegramRequestContext(c));
      return c.json(
        {
          code: "FLOW_GET_WAITING_ORDERS_PDF_NOT_IMPLEMENTED",
          error: "Flow get_waiting_orders_pdf is not implemented yet"
        },
        501
      );
    } catch (error) {
      return dependencies.handleRouteError(c, error) as never;
    }
  });
}
