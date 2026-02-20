import { serve } from "@hono/node-server";

import { createApp } from "./app.js";
import { readPositiveNumberEnv } from "./config/env.js";
import { getBackendLogFilePath } from "./logger.js";

const DEFAULT_PORT = 3000;
const SHUTDOWN_TIMEOUT_MS = 10_000;

const { app, logger } = createApp();
const port = readPositiveNumberEnv("BACKEND_PORT", DEFAULT_PORT);

logger.info({ port, logFilePath: getBackendLogFilePath() }, "backend configured");

const server = serve({
  fetch: app.fetch,
  port
});

logger.info({ port }, "backend started");

let shutdownInitiated = false;

function shutdown(signal: NodeJS.Signals) {
  if (shutdownInitiated) {
    return;
  }

  shutdownInitiated = true;
  logger.info({ signal }, "shutdown signal received");

  const forceExitTimeout = setTimeout(() => {
    logger.error({ signal, timeoutMs: SHUTDOWN_TIMEOUT_MS }, "forced shutdown after timeout");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  forceExitTimeout.unref();

  server.close((error: Error | undefined) => {
    clearTimeout(forceExitTimeout);

    if (error) {
      logger.error({ signal, error: String(error) }, "graceful shutdown failed");
      process.exit(1);
      return;
    }

    logger.info({ signal }, "server closed gracefully");
    process.exit(0);
  });
}

process.on("SIGINT", () => {
  shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});

export { app, port, server };

export default server;
