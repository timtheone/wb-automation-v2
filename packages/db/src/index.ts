import { drizzle } from "drizzle-orm/bun-sql";
import * as schema from "./schema.js";

const DEFAULT_DATABASE_URL =
  "postgres://wb-automation-db-dev-user:wb-automation-db-dev-pass@localhost:5440/wb_automation_v2";

function readRuntimeEnv(key: string): string | undefined {
  if (typeof Bun !== "undefined") {
    return Bun.env[key] ?? process.env[key];
  }

  return process.env[key];
}

export function getDatabaseUrl(): string {
  return readRuntimeEnv("DATABASE_URL") ?? DEFAULT_DATABASE_URL;
}

export function createDb(databaseUrl = getDatabaseUrl()) {
  const db = drizzle({
    connection: databaseUrl,
    schema
  });

  return {
    db,
    client: db.$client
  };
}

export type Database = ReturnType<typeof createDb>["db"];

export * from "./schema.js";
