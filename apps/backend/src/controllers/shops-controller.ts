import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";

import { readTelegramRequestContext } from "../http/telegram-context.js";
import type { RouteErrorHandler } from "../http/error-handler.js";
import { parseJsonBody } from "../http/validation.js";
import { telegramContextHeadersSchema } from "../openapi/telegram-context.js";
import {
  errorResponseSchema,
  shopResponseSchema,
  shopsResponseSchema
} from "../openapi/schemas.js";
import type { BackendShopsService } from "../services/shops-service.js";
import type { BackendTenantService } from "../services/tenant-service.js";

const shopIdParamsSchema = z
  .object({
    id: z.string().min(1)
  })
  .openapi("ShopIdParams");

const checkShopNameQuerySchema = z
  .object({
    name: z.string().trim().min(1, "name must not be empty")
  })
  .openapi("CheckShopNameQuery");

const createShopBodySchema = z
  .object({
    name: z.string().trim().min(1, "name must not be empty"),
    wbToken: z.string().trim().min(1, "wbToken must not be empty"),
    wbSandboxToken: z
      .string()
      .trim()
      .min(1, "wbSandboxToken must not be empty")
      .nullable()
      .optional(),
    useSandbox: z.boolean().optional(),
    supplyPrefix: z.string().trim().min(1, "supplyPrefix must not be empty").optional(),
    isActive: z.boolean().optional()
  })
  .openapi("CreateShopBody");

const updateShopBodySchema = z
  .object({
    name: z.string().trim().min(1, "name must not be empty").optional(),
    wbSandboxToken: z
      .string()
      .trim()
      .min(1, "wbSandboxToken must not be empty")
      .nullable()
      .optional(),
    useSandbox: z.boolean().optional(),
    supplyPrefix: z.string().trim().min(1, "supplyPrefix must not be empty").optional(),
    isActive: z.boolean().optional()
  })
  .openapi("UpdateShopBody");

const updateShopTokenBodySchema = z
  .object({
    wbToken: z.string().trim().min(1, "wbToken must not be empty"),
    tokenType: z.enum(["production", "sandbox"]).optional()
  })
  .openapi("UpdateShopTokenBody");

const listShopsRoute = createRoute({
  method: "get",
  path: "/shops",
  tags: ["Shops"],
  request: {
    headers: telegramContextHeadersSchema
  },
  responses: {
    200: {
      description: "List shops",
      content: {
        "application/json": {
          schema: shopsResponseSchema
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

const checkShopNameRoute = createRoute({
  method: "get",
  path: "/shops/check-name",
  tags: ["Shops"],
  request: {
    headers: telegramContextHeadersSchema,
    query: checkShopNameQuerySchema
  },
  responses: {
    200: {
      description: "Shop name is available",
      content: {
        "application/json": {
          schema: z.object({ available: z.boolean() })
        }
      }
    },
    400: {
      description: "Invalid request",
      content: {
        "application/json": {
          schema: errorResponseSchema
        }
      }
    },
    409: {
      description: "Shop name already exists",
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

const createShopRoute = createRoute({
  method: "post",
  path: "/shops",
  tags: ["Shops"],
  request: {
    headers: telegramContextHeadersSchema,
    body: {
      content: {
        "application/json": {
          schema: createShopBodySchema
        }
      }
    }
  },
  responses: {
    201: {
      description: "Shop created",
      content: {
        "application/json": {
          schema: shopResponseSchema
        }
      }
    },
    400: {
      description: "Invalid request body",
      content: {
        "application/json": {
          schema: errorResponseSchema
        }
      }
    },
    409: {
      description: "Shop name already exists",
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

const updateShopRoute = createRoute({
  method: "patch",
  path: "/shops/{id}",
  tags: ["Shops"],
  request: {
    headers: telegramContextHeadersSchema,
    params: shopIdParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: updateShopBodySchema
        }
      }
    }
  },
  responses: {
    200: {
      description: "Shop updated",
      content: {
        "application/json": {
          schema: shopResponseSchema
        }
      }
    },
    400: {
      description: "Invalid request body",
      content: {
        "application/json": {
          schema: errorResponseSchema
        }
      }
    },
    404: {
      description: "Shop not found",
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

const updateShopTokenRoute = createRoute({
  method: "patch",
  path: "/shops/{id}/token",
  tags: ["Shops"],
  request: {
    headers: telegramContextHeadersSchema,
    params: shopIdParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: updateShopTokenBodySchema
        }
      }
    }
  },
  responses: {
    200: {
      description: "Shop token updated",
      content: {
        "application/json": {
          schema: shopResponseSchema
        }
      }
    },
    400: {
      description: "Invalid request body",
      content: {
        "application/json": {
          schema: errorResponseSchema
        }
      }
    },
    404: {
      description: "Shop not found",
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

const deleteShopRoute = createRoute({
  method: "delete",
  path: "/shops/{id}",
  tags: ["Shops"],
  request: {
    headers: telegramContextHeadersSchema,
    params: shopIdParamsSchema
  },
  responses: {
    200: {
      description: "Shop deactivated",
      content: {
        "application/json": {
          schema: shopResponseSchema
        }
      }
    },
    404: {
      description: "Shop not found",
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

export function registerShopsController(
  app: OpenAPIHono,
  dependencies: {
    shopsService: BackendShopsService;
    tenantService: BackendTenantService;
    handleRouteError: RouteErrorHandler;
  }
) {
  app.openapi(listShopsRoute, async (c) => {
    try {
      const tenantContext = await dependencies.tenantService.resolveTenantContext(
        readTelegramRequestContext(c)
      );
      const shops = await dependencies.shopsService.listShops(tenantContext.tenantId);
      return c.json({ shops }, 200);
    } catch (error) {
      return dependencies.handleRouteError(c, error) as never;
    }
  });

  app.openapi(checkShopNameRoute, async (c) => {
    try {
      const tenantContext = await dependencies.tenantService.resolveTenantContext(
        readTelegramRequestContext(c)
      );
      const name = c.req.query("name");
      if (!name || name.trim() === "") {
        return c.json({ code: "INVALID_NAME", error: "Name parameter is required" }, 400);
      }
      const exists = await dependencies.shopsService.checkShopNameExists(
        tenantContext.tenantId,
        name.trim()
      );
      if (exists) {
        return c.json(
          { code: "SHOP_NAME_ALREADY_EXISTS", error: "Shop with this name already exists" },
          409
        );
      }
      return c.json({ available: true }, 200);
    } catch (error) {
      return dependencies.handleRouteError(c, error) as never;
    }
  });

  app.openapi(createShopRoute, async (c) => {
    try {
      const tenantContext = await dependencies.tenantService.resolveTenantContext(
        readTelegramRequestContext(c)
      );
      const body = await parseJsonBody(c, createShopBodySchema);
      const shop = await dependencies.shopsService.createShop(tenantContext.tenantId, body);
      return c.json({ shop }, 201);
    } catch (error) {
      return dependencies.handleRouteError(c, error) as never;
    }
  });

  app.openapi(updateShopRoute, async (c) => {
    try {
      const tenantContext = await dependencies.tenantService.resolveTenantContext(
        readTelegramRequestContext(c)
      );
      const body = await parseJsonBody(c, updateShopBodySchema);
      const shop = await dependencies.shopsService.updateShop(tenantContext.tenantId, {
        id: c.req.param("id"),
        ...body
      });

      return c.json({ shop }, 200);
    } catch (error) {
      return dependencies.handleRouteError(c, error) as never;
    }
  });

  app.openapi(updateShopTokenRoute, async (c) => {
    try {
      const tenantContext = await dependencies.tenantService.resolveTenantContext(
        readTelegramRequestContext(c)
      );
      const body = await parseJsonBody(c, updateShopTokenBodySchema);
      const shop = await dependencies.shopsService.updateShopToken(tenantContext.tenantId, {
        id: c.req.param("id"),
        wbToken: body.wbToken,
        tokenType: body.tokenType
      });

      return c.json({ shop }, 200);
    } catch (error) {
      return dependencies.handleRouteError(c, error) as never;
    }
  });

  app.openapi(deleteShopRoute, async (c) => {
    try {
      const tenantContext = await dependencies.tenantService.resolveTenantContext(
        readTelegramRequestContext(c)
      );
      const shop = await dependencies.shopsService.deactivateShop(
        tenantContext.tenantId,
        c.req.param("id")
      );
      return c.json({ shop }, 200);
    } catch (error) {
      return dependencies.handleRouteError(c, error) as never;
    }
  });
}
