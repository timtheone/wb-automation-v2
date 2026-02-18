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
  uniqueIndex,
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

export const telegramChatTypeEnum = pgEnum("telegram_chat_type", [
  "private",
  "group",
  "supergroup",
  "channel"
]);

export const tenants = pgTable("tenants", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerTelegramUserId: bigint("owner_telegram_user_id", { mode: "number" }).notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const tenantChats = pgTable(
  "tenant_chats",
  {
    chatId: bigint("chat_id", { mode: "number" }).primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    ownerTelegramUserId: bigint("owner_telegram_user_id", { mode: "number" }).notNull(),
    chatType: telegramChatTypeEnum("chat_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index("tenant_chats_tenant_idx").on(table.tenantId)]
);

export const shops = pgTable(
  "shops",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    wbToken: text("wb_token").notNull(),
    wbSandboxToken: text("wb_sandbox_token"),
    useSandbox: boolean("use_sandbox").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    supplyPrefix: text("supply_prefix").notNull().default("игрушки_"),
    tokenUpdatedAt: timestamp("token_updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("shops_tenant_name_unique_idx").on(table.tenantId, table.name),
    index("shops_tenant_created_idx").on(table.tenantId, table.createdAt)
  ]
);

export const productCards = pgTable(
  "product_cards",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
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
    index("product_cards_tenant_shop_wb_updated_idx").on(table.tenantId, table.shopId, table.wbUpdatedAt)
  ]
);

export const syncState = pgTable(
  "sync_state",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    cursorUpdatedAt: timestamp("cursor_updated_at", { withTimezone: true }),
    cursorNmId: bigint("cursor_nm_id", { mode: "number" }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastStatus: syncStatusEnum("last_status").notNull().default("idle"),
    lastError: text("last_error"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.shopId] }),
    index("sync_state_tenant_shop_idx").on(table.tenantId, table.shopId)
  ]
);

export const jobRuns = pgTable(
  "job_runs",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    jobType: jobTypeEnum("job_type").notNull(),
    status: jobStatusEnum("status").notNull().default("running"),
    shopId: uuid("shop_id").references(() => shops.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    details: jsonb("details").$type<Record<string, unknown>>(),
    error: text("error")
  },
  (table) => [
    index("job_runs_tenant_job_type_started_idx").on(table.tenantId, table.jobType, table.startedAt),
    index("job_runs_tenant_status_started_idx").on(table.tenantId, table.status, table.startedAt)
  ]
);

export const tenantsRelations = relations(tenants, ({ many }) => {
  return {
    chats: many(tenantChats),
    shops: many(shops),
    productCards: many(productCards),
    syncState: many(syncState),
    jobRuns: many(jobRuns)
  };
});

export const tenantChatsRelations = relations(tenantChats, ({ one }) => {
  return {
    tenant: one(tenants, {
      fields: [tenantChats.tenantId],
      references: [tenants.id]
    })
  };
});

export const shopsRelations = relations(shops, ({ many, one }) => {
  return {
    tenant: one(tenants, {
      fields: [shops.tenantId],
      references: [tenants.id]
    }),
    productCards: many(productCards),
    syncState: one(syncState),
    jobRuns: many(jobRuns)
  };
});

export const productCardsRelations = relations(productCards, ({ one }) => {
  return {
    tenant: one(tenants, {
      fields: [productCards.tenantId],
      references: [tenants.id]
    }),
    shop: one(shops, {
      fields: [productCards.shopId],
      references: [shops.id]
    })
  };
});

export const syncStateRelations = relations(syncState, ({ one }) => {
  return {
    tenant: one(tenants, {
      fields: [syncState.tenantId],
      references: [tenants.id]
    }),
    shop: one(shops, {
      fields: [syncState.shopId],
      references: [shops.id]
    })
  };
});

export const jobRunsRelations = relations(jobRuns, ({ one }) => {
  return {
    tenant: one(tenants, {
      fields: [jobRuns.tenantId],
      references: [tenants.id]
    }),
    shop: one(shops, {
      fields: [jobRuns.shopId],
      references: [shops.id]
    })
  };
});
