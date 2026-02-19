import { createApp } from "./app.js";
import { readPositiveNumberEnv } from "./config/env.js";
import { getBackendLogFilePath } from "./logger.js";

const DEFAULT_PORT = 3000;

const { app, logger } = createApp();
const port = readPositiveNumberEnv("BACKEND_PORT", DEFAULT_PORT);

logger.info({ port, logFilePath: getBackendLogFilePath() }, "backend configured");

export { app };

export default {
  port,
  fetch: app.fetch,
  idleTimeout: 120
};
