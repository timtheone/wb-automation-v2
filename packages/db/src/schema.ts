import { relations } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid
} from "drizzle-orm/pg-core";

export const syncStatusEnum = pgEnum("sync_status", ["idle", "running", "success", "failed"]);

export const jobTypeEnum = pgEnum("job_type", [
  "process_all_shops",
  "sync_content_shops",
  "get_combined_pdf_lists",
  "get_waiting_orders_pdf"
]);

export const jobStatusEnum = pgEnum("job_status", ["running", "success", "failed"]);

export const shops = pgTable("shops", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  wbToken: text("wb_token").notNull(),
  wbSandboxToken: text("wb_sandbox_token"),
  useSandbox: boolean("use_sandbox").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  supplyPrefix: text("supply_prefix").notNull().default("игрушки_"),
  tokenUpdatedAt: timestamp("token_updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const productCards = pgTable(
  "product_cards",
  {
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    nmId: bigint("nm_id", { mode: "number" }).notNull(),
    vendorCode: text("vendor_code"),
    brand: text("brand"),
    title: text("title"),
    img: text("img"),
    ageGroup: text("age_group"),
    wbCreatedAt: timestamp("wb_created_at", { withTimezone: true }),
    wbUpdatedAt: timestamp("wb_updated_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    primaryKey({ columns: [table.shopId, table.nmId] }),
    index("product_cards_shop_wb_updated_idx").on(table.shopId, table.wbUpdatedAt)
  ]
);

export const syncState = pgTable("sync_state", {
  shopId: uuid("shop_id")
    .primaryKey()
    .references(() => shops.id, { onDelete: "cascade" }),
  cursorUpdatedAt: timestamp("cursor_updated_at", { withTimezone: true }),
  cursorNmId: bigint("cursor_nm_id", { mode: "number" }),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastStatus: syncStatusEnum("last_status").notNull().default("idle"),
  lastError: text("last_error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const jobRuns = pgTable(
  "job_runs",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    jobType: jobTypeEnum("job_type").notNull(),
    status: jobStatusEnum("status").notNull().default("running"),
    shopId: uuid("shop_id").references(() => shops.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    details: jsonb("details").$type<Record<string, unknown>>(),
    error: text("error")
  },
  (table) => [
    index("job_runs_job_type_started_idx").on(table.jobType, table.startedAt),
    index("job_runs_status_started_idx").on(table.status, table.startedAt)
  ]
);

export const shopsRelations = relations(shops, ({ many, one }) => {
  return {
    productCards: many(productCards),
    syncState: one(syncState),
    jobRuns: many(jobRuns)
  };
});

export const productCardsRelations = relations(productCards, ({ one }) => {
  return {
    shop: one(shops, {
      fields: [productCards.shopId],
      references: [shops.id]
    })
  };
});

export const syncStateRelations = relations(syncState, ({ one }) => {
  return {
    shop: one(shops, {
      fields: [syncState.shopId],
      references: [shops.id]
    })
  };
});

export const jobRunsRelations = relations(jobRuns, ({ one }) => {
  return {
    shop: one(shops, {
      fields: [jobRuns.shopId],
      references: [shops.id]
    })
  };
});
