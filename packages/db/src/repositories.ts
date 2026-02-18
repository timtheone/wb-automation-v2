import { and, asc, desc, eq, sql } from "drizzle-orm";

import { getDatabase, type Database } from "./index.js";
import { productCards, shops, syncState, tenantChats, tenants } from "./schema.js";

export type SyncStatus = "idle" | "running" | "success" | "failed";
export type WbTokenType = "production" | "sandbox";
export type TelegramChatType = "private" | "group" | "supergroup" | "channel";

export interface Tenant {
  id: string;
  ownerTelegramUserId: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantChat {
  chatId: number;
  tenantId: string;
  ownerTelegramUserId: number;
  chatType: TelegramChatType;
  createdAt: Date;
  updatedAt: Date;
}

export interface Shop {
  id: string;
  name: string;
  wbToken: string;
  wbSandboxToken: string | null;
  useSandbox: boolean;
  isActive: boolean;
  supplyPrefix: string;
  tokenUpdatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductCard {
  shopId: string;
  nmId: number;
  vendorCode: string | null;
  brand: string | null;
  title: string | null;
  img: string | null;
  ageGroup: string | null;
  wbCreatedAt: Date | null;
  wbUpdatedAt: Date | null;
  syncedAt: Date;
}

export interface SyncState {
  shopId: string;
  cursorUpdatedAt: Date | null;
  cursorNmId: number | null;
  lastSyncedAt: Date | null;
  lastStatus: SyncStatus;
  lastError: string | null;
  updatedAt: Date;
}

export interface CreateShopInput {
  name: string;
  wbToken: string;
  wbSandboxToken?: string | null;
  useSandbox?: boolean;
  supplyPrefix?: string;
  isActive?: boolean;
}

export interface UpdateShopInput {
  id: string;
  name?: string;
  wbSandboxToken?: string | null;
  useSandbox?: boolean;
  supplyPrefix?: string;
  isActive?: boolean;
}

export interface UpdateShopTokenInput {
  id: string;
  wbToken: string;
  tokenType?: WbTokenType;
}

export interface UpsertTenantChatInput {
  chatId: number;
  tenantId: string;
  ownerTelegramUserId: number;
  chatType: TelegramChatType;
}

export interface UpsertSyncStateInput {
  shopId: string;
  cursorUpdatedAt: Date | null;
  cursorNmId: number | null;
  lastSyncedAt: Date | null;
  lastStatus: SyncStatus;
  lastError: string | null;
  updatedAt: Date;
}

export interface TenantRepository {
  listTenants(): Promise<Tenant[]>;
  getOrCreateByOwnerTelegramUserId(ownerTelegramUserId: number): Promise<Tenant>;
}

export interface TenantChatRepository {
  getByChatId(chatId: number): Promise<TenantChat | null>;
  upsert(input: UpsertTenantChatInput): Promise<TenantChat>;
}

export interface ShopRepository {
  listShops(): Promise<Shop[]>;
  listActiveShops(): Promise<Shop[]>;
  getShopById(id: string): Promise<Shop | null>;
  createShop(input: CreateShopInput): Promise<Shop>;
  updateShop(id: string, patch: Omit<UpdateShopInput, "id">): Promise<Shop | null>;
  updateShopToken(
    id: string,
    wbToken: string,
    tokenUpdatedAt: Date,
    tokenType?: WbTokenType
  ): Promise<Shop | null>;
  deactivateShop(id: string): Promise<Shop | null>;
}

export interface ProductCardRepository {
  upsertMany(cards: ProductCard[]): Promise<number>;
}

export interface SyncStateRepository {
  getByShopId(shopId: string): Promise<SyncState | null>;
  upsert(input: UpsertSyncStateInput): Promise<void>;
}

export interface DbRepositories {
  shops: ShopRepository;
  productCards: ProductCardRepository;
  syncState: SyncStateRepository;
}

export interface TenantScopedRepositoryOptions {
  tenantId: string;
  db?: Database;
}

interface TenantDbContext {
  tenantId: string;
  db: Database;
}

export function createDbRepositories(options: TenantScopedRepositoryOptions): DbRepositories {
  return {
    shops: createShopRepository(options),
    productCards: createProductCardRepository(options),
    syncState: createSyncStateRepository(options)
  };
}

export function createTenantRepository(db: Database = getDatabase()): TenantRepository {
  return {
    async listTenants() {
      const rows = await db.select().from(tenants).orderBy(asc(tenants.ownerTelegramUserId));
      return rows.map(mapTenant);
    },

    async getOrCreateByOwnerTelegramUserId(ownerTelegramUserId: number) {
      const now = new Date();
      const [row] = await db
        .insert(tenants)
        .values({
          ownerTelegramUserId,
          updatedAt: now
        })
        .onConflictDoUpdate({
          target: tenants.ownerTelegramUserId,
          set: {
            updatedAt: now
          }
        })
        .returning();

      if (!row) {
        throw new Error("Failed to resolve tenant by owner telegram user id");
      }

      return mapTenant(row);
    }
  };
}

export function createTenantChatRepository(db: Database = getDatabase()): TenantChatRepository {
  return {
    async getByChatId(chatId: number) {
      const [row] = await db.select().from(tenantChats).where(eq(tenantChats.chatId, chatId)).limit(1);
      return row ? mapTenantChat(row) : null;
    },

    async upsert(input: UpsertTenantChatInput) {
      const now = new Date();
      const [row] = await db
        .insert(tenantChats)
        .values({
          chatId: input.chatId,
          tenantId: input.tenantId,
          ownerTelegramUserId: input.ownerTelegramUserId,
          chatType: input.chatType,
          updatedAt: now
        })
        .onConflictDoUpdate({
          target: tenantChats.chatId,
          set: {
            tenantId: input.tenantId,
            ownerTelegramUserId: input.ownerTelegramUserId,
            chatType: input.chatType,
            updatedAt: now
          }
        })
        .returning();

      if (!row) {
        throw new Error("Failed to upsert tenant chat mapping");
      }

      return mapTenantChat(row);
    }
  };
}

export function createShopRepository(options: TenantScopedRepositoryOptions): ShopRepository {
  const context = createTenantContext(options);

  return {
    async listShops() {
      return withTenantScope(context, async (db) => {
        const rows = await db
          .select()
          .from(shops)
          .where(eq(shops.tenantId, context.tenantId))
          .orderBy(desc(shops.createdAt));

        return rows.map(mapShop);
      });
    },

    async listActiveShops() {
      return withTenantScope(context, async (db) => {
        const rows = await db
          .select()
          .from(shops)
          .where(and(eq(shops.tenantId, context.tenantId), eq(shops.isActive, true)))
          .orderBy(desc(shops.createdAt));

        return rows.map(mapShop);
      });
    },

    async getShopById(id) {
      return withTenantScope(context, async (db) => {
        const [row] = await db
          .select()
          .from(shops)
          .where(and(eq(shops.tenantId, context.tenantId), eq(shops.id, id)))
          .limit(1);

        return row ? mapShop(row) : null;
      });
    },

    async createShop(input: CreateShopInput) {
      return withTenantScope(context, async (db) => {
        const [row] = await db
          .insert(shops)
          .values({
            tenantId: context.tenantId,
            name: input.name,
            wbToken: input.wbToken,
            wbSandboxToken: input.wbSandboxToken ?? null,
            useSandbox: input.useSandbox ?? false,
            isActive: input.isActive ?? true,
            supplyPrefix: input.supplyPrefix ?? "игрушки_",
            tokenUpdatedAt: new Date(),
            updatedAt: new Date()
          })
          .returning();

        if (!row) {
          throw new Error("Failed to create shop");
        }

        return mapShop(row);
      });
    },

    async updateShop(id: string, patch: Omit<UpdateShopInput, "id">) {
      if (Object.keys(patch).length === 0) {
        return this.getShopById(id);
      }

      return withTenantScope(context, async (db) => {
        const [row] = await db
          .update(shops)
          .set({
            ...patch,
            updatedAt: new Date()
          })
          .where(and(eq(shops.tenantId, context.tenantId), eq(shops.id, id)))
          .returning();

        return row ? mapShop(row) : null;
      });
    },

    async updateShopToken(id, wbToken, tokenUpdatedAt, tokenType = "production") {
      const patch =
        tokenType === "sandbox"
          ? {
              wbSandboxToken: wbToken,
              updatedAt: tokenUpdatedAt
            }
          : {
              wbToken,
              tokenUpdatedAt,
              updatedAt: tokenUpdatedAt
            };

      return withTenantScope(context, async (db) => {
        const [row] = await db
          .update(shops)
          .set(patch)
          .where(and(eq(shops.tenantId, context.tenantId), eq(shops.id, id)))
          .returning();

        return row ? mapShop(row) : null;
      });
    },

    async deactivateShop(id) {
      return withTenantScope(context, async (db) => {
        const [row] = await db
          .update(shops)
          .set({
            isActive: false,
            updatedAt: new Date()
          })
          .where(and(eq(shops.tenantId, context.tenantId), eq(shops.id, id)))
          .returning();

        return row ? mapShop(row) : null;
      });
    }
  };
}

export function createProductCardRepository(options: TenantScopedRepositoryOptions): ProductCardRepository {
  const context = createTenantContext(options);

  return {
    async upsertMany(cards: ProductCard[]): Promise<number> {
      if (cards.length === 0) {
        return 0;
      }

      const rows = cards.map((card) => ({
        tenantId: context.tenantId,
        shopId: card.shopId,
        nmId: card.nmId,
        vendorCode: card.vendorCode,
        brand: card.brand,
        title: card.title,
        img: card.img,
        ageGroup: card.ageGroup,
        wbCreatedAt: card.wbCreatedAt,
        wbUpdatedAt: card.wbUpdatedAt,
        syncedAt: card.syncedAt,
        updatedAt: card.syncedAt
      }));

      await withTenantScope(context, async (db) => {
        await db
          .insert(productCards)
          .values(rows)
          .onConflictDoUpdate({
            target: [productCards.shopId, productCards.nmId],
            set: {
              vendorCode: sql`excluded.vendor_code`,
              brand: sql`excluded.brand`,
              title: sql`excluded.title`,
              img: sql`excluded.img`,
              ageGroup: sql`excluded.age_group`,
              wbCreatedAt: sql`excluded.wb_created_at`,
              wbUpdatedAt: sql`excluded.wb_updated_at`,
              syncedAt: sql`excluded.synced_at`,
              updatedAt: sql`excluded.updated_at`
            }
          });
      });

      return cards.length;
    }
  };
}

export function createSyncStateRepository(options: TenantScopedRepositoryOptions): SyncStateRepository {
  const context = createTenantContext(options);

  return {
    async getByShopId(shopId: string): Promise<SyncState | null> {
      return withTenantScope(context, async (db) => {
        const [row] = await db
          .select()
          .from(syncState)
          .where(and(eq(syncState.tenantId, context.tenantId), eq(syncState.shopId, shopId)))
          .limit(1);

        return row ? mapSyncState(row) : null;
      });
    },

    async upsert(input: UpsertSyncStateInput): Promise<void> {
      await withTenantScope(context, async (db) => {
        await db
          .insert(syncState)
          .values({
            tenantId: context.tenantId,
            shopId: input.shopId,
            cursorUpdatedAt: input.cursorUpdatedAt,
            cursorNmId: input.cursorNmId,
            lastSyncedAt: input.lastSyncedAt,
            lastStatus: input.lastStatus,
            lastError: input.lastError,
            updatedAt: input.updatedAt
          })
          .onConflictDoUpdate({
            target: [syncState.tenantId, syncState.shopId],
            set: {
              cursorUpdatedAt: input.cursorUpdatedAt,
              cursorNmId: input.cursorNmId,
              lastSyncedAt: input.lastSyncedAt,
              lastStatus: input.lastStatus,
              lastError: input.lastError,
              updatedAt: input.updatedAt
            }
          });
      });
    }
  };
}

function createTenantContext(options: TenantScopedRepositoryOptions): TenantDbContext {
  return {
    tenantId: options.tenantId,
    db: options.db ?? getDatabase()
  };
}

async function withTenantScope<T>(context: TenantDbContext, operation: (db: Database) => Promise<T>): Promise<T> {
  return context.db.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    await tx.execute(sql`select set_config('app.tenant_id', ${context.tenantId}, true)`);
    return operation(tx);
  });
}

function mapTenant(row: typeof tenants.$inferSelect): Tenant {
  return {
    id: row.id,
    ownerTelegramUserId: row.ownerTelegramUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapTenantChat(row: typeof tenantChats.$inferSelect): TenantChat {
  return {
    chatId: row.chatId,
    tenantId: row.tenantId,
    ownerTelegramUserId: row.ownerTelegramUserId,
    chatType: row.chatType,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapShop(row: typeof shops.$inferSelect): Shop {
  return {
    id: row.id,
    name: row.name,
    wbToken: row.wbToken,
    wbSandboxToken: row.wbSandboxToken,
    useSandbox: row.useSandbox,
    isActive: row.isActive,
    supplyPrefix: row.supplyPrefix,
    tokenUpdatedAt: row.tokenUpdatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapSyncState(row: typeof syncState.$inferSelect): SyncState {
  return {
    shopId: row.shopId,
    cursorUpdatedAt: row.cursorUpdatedAt,
    cursorNmId: row.cursorNmId,
    lastSyncedAt: row.lastSyncedAt,
    lastStatus: row.lastStatus,
    lastError: row.lastError,
    updatedAt: row.updatedAt
  };
}
