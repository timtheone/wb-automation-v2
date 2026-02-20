import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pino from "pino";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceRootDirectory = resolve(moduleDirectory, "../../..");
const defaultLogFilePath = resolve(workspaceRootDirectory, "logs/bot.log");

const logFilePath = readRuntimeEnv("BOT_LOG_FILE") ?? defaultLogFilePath;
const logLevel = readRuntimeEnv("BOT_LOG_LEVEL") ?? "info";

const stdoutStream = pino.destination({ dest: 1, sync: false });
const fileStream = pino.destination({ dest: logFilePath, mkdir: true, sync: false });

export const logger = pino(
  {
    level: logLevel,
    base: {
      service: "bot"
    },
    timestamp: pino.stdTimeFunctions.isoTime
  },
  pino.multistream([{ stream: stdoutStream }, { stream: fileStream }])
);

export function getBotLogFilePath() {
  return logFilePath;
}

function readRuntimeEnv(key: string): string | undefined {
  return process.env[key];
}
