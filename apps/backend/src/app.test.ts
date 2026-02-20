import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  runtimeEnv: {} as Record<string, string | undefined>,
  loggerInfo: vi.fn(),
  registerShopsController: vi.fn(),
  registerFlowsController: vi.fn(),
  createRouteErrorHandler: vi.fn(),
  createBackendServices: vi.fn()
}));

vi.mock("./config/env.js", async () => {
  return {
    readRuntimeEnv: (key: string) => testState.runtimeEnv[key]
  };
});

vi.mock("./logger.js", async () => {
  return {
    createLogger: () => ({
      info: testState.loggerInfo,
      warn: vi.fn(),
      error: vi.fn()
    })
  };
});

vi.mock("./services/index.js", async () => {
  return {
    createBackendServices: testState.createBackendServices
  };
});

vi.mock("./http/error-handler.js", async () => {
  return {
    createRouteErrorHandler: testState.createRouteErrorHandler
  };
});

vi.mock("./controllers/health-controller.js", async () => {
  return {
    registerHealthController: (app: {
      get: (path: string, handler: (c: any) => unknown) => unknown;
    }) => {
      app.get("/health", (c: any) => c.json({ status: "ok", service: "backend" }, 200));
    }
  };
});

vi.mock("./controllers/shops-controller.js", async () => {
  return {
    registerShopsController: testState.registerShopsController
  };
});

vi.mock("./controllers/flows-controller.js", async () => {
  return {
    registerFlowsController: testState.registerFlowsController
  };
});

import { createApp } from "./app.js";

describe("backend app bootstrap", () => {
  beforeEach(() => {
    testState.runtimeEnv = {};
    testState.loggerInfo.mockReset();
    testState.registerShopsController.mockReset();
    testState.registerFlowsController.mockReset();
    testState.createRouteErrorHandler.mockReset();
    testState.createBackendServices.mockReset();

    testState.createBackendServices.mockReturnValue({
      shopsService: { kind: "shops" },
      flowsService: { kind: "flows" },
      tenantService: { kind: "tenant" }
    });
    testState.createRouteErrorHandler.mockReturnValue(() => new Response("error", { status: 500 }));
  });

  it("wires controllers with shared services and route error handler", () => {
    createApp();

    const handleRouteError = testState.createRouteErrorHandler.mock.results[0]?.value;
    const services = testState.createBackendServices.mock.results[0]?.value;

    expect(testState.registerShopsController).toHaveBeenCalledTimes(1);
    expect(testState.registerShopsController).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        shopsService: services.shopsService,
        tenantService: services.tenantService,
        handleRouteError
      })
    );

    expect(testState.registerFlowsController).toHaveBeenCalledTimes(1);
    expect(testState.registerFlowsController).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        flowsService: services.flowsService,
        tenantService: services.tenantService,
        handleRouteError
      })
    );
  });

  it("skips healthcheck request logs by default", async () => {
    const { app } = createApp();

    const response = await app.request("/health", {
      method: "GET"
    });

    expect(response.status).toBe(200);
    expect(testState.loggerInfo).not.toHaveBeenCalled();
  });

  it("logs healthchecks when BACKEND_LOG_HEALTHCHECKS=true", async () => {
    testState.runtimeEnv.BACKEND_LOG_HEALTHCHECKS = "true";

    const { app } = createApp();

    const response = await app.request("/health", {
      method: "GET"
    });

    expect(response.status).toBe(200);
    expect(testState.loggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/health",
        status: 200
      }),
      "request completed"
    );
  });
});
