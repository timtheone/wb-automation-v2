import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

const DEFAULT_DATABASE_URL =
  "postgres://wb-automation-db-dev-user:wb-automation-db-dev-pass@localhost:5440/wb_automation_v2";

function readRuntimeEnv(key: string): string | undefined {
  return process.env[key];
}

export function getDatabaseUrl(): string {
  return readRuntimeEnv("DATABASE_URL") ?? DEFAULT_DATABASE_URL;
}

export function createDb(databaseUrl = getDatabaseUrl()) {
  const client = new Pool({ connectionString: databaseUrl });
  const db = drizzle(client, { schema });

  return {
    db,
    client
  };
}

export type Database = ReturnType<typeof createDb>["db"];
type DbConnection = ReturnType<typeof createDb>;

let singletonConnection: DbConnection | null = null;

export function getDb(): DbConnection {
  if (!singletonConnection) {
    singletonConnection = createDb();
  }

  return singletonConnection;
}

export function getDatabase(): Database {
  return getDb().db;
}

export function getDatabaseClient() {
  return getDb().client;
}

export * from "./repositories.js";
export * from "./schema.js";
