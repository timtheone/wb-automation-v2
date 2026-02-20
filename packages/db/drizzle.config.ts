import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

const envMode = (process.env.WB_ENV ?? process.env.APP_ENV ?? process.env.NODE_ENV ?? "local").toLowerCase();
const primaryEnvFile = envMode === "production" ? "../../.env" : "../../.env.local";

config({ path: primaryEnvFile, override: false });

if (primaryEnvFile !== "../../.env") {
  config({ path: "../../.env", override: false });
}

const databaseUrl =
  process.env.DATABASE_URL ??
  (typeof Bun !== "undefined" ? Bun.env.DATABASE_URL : undefined) ??
  "postgres://wb-automation-db-dev-user:wb-automation-db-dev-pass@localhost:5440/wb_automation_v2";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl
  },
  strict: true,
  verbose: true
});
