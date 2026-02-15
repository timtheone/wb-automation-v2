import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const shops = pgTable("shops", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  wbToken: text("wb_token").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  supplyPrefix: text("supply_prefix").notNull().default("igrushki_"),
  tokenUpdatedAt: timestamp("token_updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});
