import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  port: 3000,
  loggerInfo: vi.fn(),
  serve: vi.fn(),
  fetchHandler: vi.fn(),
  serverClose: vi.fn()
}));

vi.mock("@hono/node-server", async () => {
  return {
    serve: testState.serve
  };
});

vi.mock("./app.js", async () => {
  return {
    createApp: () => ({
      app: {
        fetch: testState.fetchHandler
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
    testState.fetchHandler.mockReset();
    testState.serverClose.mockReset();
    testState.serve.mockReset();
    testState.serve.mockReturnValue({ close: testState.serverClose });
  });

  it("starts hono node server with configured port", async () => {
    testState.port = 4321;

    vi.resetModules();
    const module = await import("./index.ts");

    expect(testState.serve).toHaveBeenCalledWith({
      fetch: testState.fetchHandler,
      port: 4321
    });
    expect(module.default).toEqual({ close: testState.serverClose });
    expect(module.port).toBe(4321);
    expect(module.app).toBeDefined();
    expect(testState.loggerInfo).toHaveBeenCalledWith(
      {
        port: 4321,
        logFilePath: "/tmp/backend.log"
      },
      "backend configured"
    );
    expect(testState.loggerInfo).toHaveBeenCalledWith({ port: 4321 }, "backend started");
  });
});
