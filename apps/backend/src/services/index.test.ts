import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  createBackendShopsService: vi.fn(),
  createBackendFlowsService: vi.fn(),
  createBackendTenantService: vi.fn()
}));

vi.mock("./shops-service.js", async () => {
  return {
    createBackendShopsService: testState.createBackendShopsService
  };
});

vi.mock("./flows-service.js", async () => {
  return {
    createBackendFlowsService: testState.createBackendFlowsService
  };
});

vi.mock("./tenant-service.js", async () => {
  return {
    createBackendTenantService: testState.createBackendTenantService
  };
});

import { createBackendServices } from "./index.js";

describe("createBackendServices", () => {
  beforeEach(() => {
    testState.createBackendShopsService.mockReset();
    testState.createBackendFlowsService.mockReset();
    testState.createBackendTenantService.mockReset();

    testState.createBackendShopsService.mockReturnValue({ name: "shops" });
    testState.createBackendFlowsService.mockReturnValue({ name: "flows" });
    testState.createBackendTenantService.mockReturnValue({ name: "tenant" });
  });

  it("constructs backend service bundle", () => {
    const services = createBackendServices();

    expect(testState.createBackendShopsService).toHaveBeenCalledTimes(1);
    expect(testState.createBackendFlowsService).toHaveBeenCalledTimes(1);
    expect(testState.createBackendTenantService).toHaveBeenCalledTimes(1);

    expect(services).toEqual({
      shopsService: { name: "shops" },
      flowsService: { name: "flows" },
      tenantService: { name: "tenant" }
    });
  });
});
