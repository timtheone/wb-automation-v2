import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  port: 3000,
  loggerInfo: vi.fn()
}));

vi.mock("./app.js", async () => {
  return {
    createApp: () => ({
      app: {
        fetch: vi.fn()
      },
      logger: {
        info: testState.loggerInfo
      }
    })
  };
});

vi.mock("./config/env.js", async () => {
  return {
    readPositiveNumberEnv: () => testState.port
  };
});

vi.mock("./logger.js", async () => {
  return {
    getBackendLogFilePath: () => "/tmp/backend.log"
  };
});

describe("backend index entry", () => {
  beforeEach(() => {
    testState.port = 3000;
    testState.loggerInfo.mockReset();
  });

  it("exports app instance and default Bun server object", async () => {
    testState.port = 4321;

    vi.resetModules();
    const module = await import("./index.ts");

    expect(module.default).toEqual({
      port: 4321,
      fetch: expect.any(Function),
      idleTimeout: 120
    });
    expect(module.app).toBeDefined();
    expect(testState.loggerInfo).toHaveBeenCalledWith(
      {
        port: 4321,
        logFilePath: "/tmp/backend.log"
      },
      "backend configured"
    );
  });
});
