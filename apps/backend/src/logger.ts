import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pino from "pino";

import { readRuntimeEnv } from "./config/env.js";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceRootDirectory = resolve(moduleDirectory, "../../..");
const defaultLogFilePath = resolve(workspaceRootDirectory, "logs/backend.log");

const logFilePath = readRuntimeEnv("BACKEND_LOG_FILE") ?? defaultLogFilePath;
const logLevel = readRuntimeEnv("BACKEND_LOG_LEVEL") ?? "info";

const stdoutStream = pino.destination({ dest: 1, sync: false });
const fileStream = pino.destination({ dest: logFilePath, mkdir: true, sync: false });

export const logger = pino(
  {
    level: logLevel,
    base: {
      service: "backend"
    },
    timestamp: pino.stdTimeFunctions.isoTime
  },
  pino.multistream([{ stream: stdoutStream }, { stream: fileStream }])
);

export function createLogger(bindings: Record<string, string>) {
  return logger.child(bindings);
}

export function getBackendLogFilePath() {
  return logFilePath;
}
