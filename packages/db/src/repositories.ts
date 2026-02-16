import { desc, eq, sql } from "drizzle-orm";

import { getDatabase, type Database } from "./index.js";
import { productCards, shops, syncState } from "./schema.js";

export type SyncStatus = "idle" | "running" | "success" | "failed";

export interface Shop {
  id: string;
  name: string;
  wbToken: string;
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
  supplyPrefix?: string;
  isActive?: boolean;
}

export interface UpdateShopInput {
  id: string;
  name?: string;
  supplyPrefix?: string;
  isActive?: boolean;
}

export interface UpdateShopTokenInput {
  id: string;
  wbToken: string;
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

export interface ShopRepository {
  listShops(): Promise<Shop[]>;
  listActiveShops(): Promise<Shop[]>;
  getShopById(id: string): Promise<Shop | null>;
  createShop(input: CreateShopInput): Promise<Shop>;
  updateShop(id: string, patch: Omit<UpdateShopInput, "id">): Promise<Shop | null>;
  updateShopToken(id: string, wbToken: string, tokenUpdatedAt: Date): Promise<Shop | null>;
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

export function createDbRepositories(db: Database = getDatabase()): DbRepositories {
  return {
    shops: createShopRepository(db),
    productCards: createProductCardRepository(db),
    syncState: createSyncStateRepository(db)
  };
}

export function createShopRepository(db: Database = getDatabase()): ShopRepository {
  return {
    async listShops() {
      const rows = await db.select().from(shops).orderBy(desc(shops.createdAt));
      return rows.map(mapShop);
    },

    async listActiveShops() {
      const rows = await db
        .select()
        .from(shops)
        .where(eq(shops.isActive, true))
        .orderBy(desc(shops.createdAt));

      return rows.map(mapShop);
    },

    async getShopById(id) {
      const [row] = await db.select().from(shops).where(eq(shops.id, id)).limit(1);
      return row ? mapShop(row) : null;
    },

    async createShop(input: CreateShopInput) {
      const [row] = await db
        .insert(shops)
        .values({
          name: input.name,
          wbToken: input.wbToken,
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
    },

    async updateShop(id: string, patch: Omit<UpdateShopInput, "id">) {
      if (Object.keys(patch).length === 0) {
        return this.getShopById(id);
      }

      const [row] = await db
        .update(shops)
        .set({
          ...patch,
          updatedAt: new Date()
        })
        .where(eq(shops.id, id))
        .returning();

      return row ? mapShop(row) : null;
    },

    async updateShopToken(id, wbToken, tokenUpdatedAt) {
      const [row] = await db
        .update(shops)
        .set({
          wbToken,
          tokenUpdatedAt,
          updatedAt: tokenUpdatedAt
        })
        .where(eq(shops.id, id))
        .returning();

      return row ? mapShop(row) : null;
    },

    async deactivateShop(id) {
      const [row] = await db
        .update(shops)
        .set({
          isActive: false,
          updatedAt: new Date()
        })
        .where(eq(shops.id, id))
        .returning();

      return row ? mapShop(row) : null;
    }
  };
}

export function createProductCardRepository(db: Database = getDatabase()): ProductCardRepository {
  return {
    async upsertMany(cards: ProductCard[]): Promise<number> {
      if (cards.length === 0) {
        return 0;
      }

      const rows = cards.map((card) => ({
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

      return cards.length;
    }
  };
}

export function createSyncStateRepository(db: Database = getDatabase()): SyncStateRepository {
  return {
    async getByShopId(shopId: string): Promise<SyncState | null> {
      const [row] = await db.select().from(syncState).where(eq(syncState.shopId, shopId)).limit(1);
      return row ? mapSyncState(row) : null;
    },

    async upsert(input: UpsertSyncStateInput): Promise<void> {
      await db
        .insert(syncState)
        .values({
          shopId: input.shopId,
          cursorUpdatedAt: input.cursorUpdatedAt,
          cursorNmId: input.cursorNmId,
          lastSyncedAt: input.lastSyncedAt,
          lastStatus: input.lastStatus,
          lastError: input.lastError,
          updatedAt: input.updatedAt
        })
        .onConflictDoUpdate({
          target: syncState.shopId,
          set: {
            cursorUpdatedAt: input.cursorUpdatedAt,
            cursorNmId: input.cursorNmId,
            lastSyncedAt: input.lastSyncedAt,
            lastStatus: input.lastStatus,
            lastError: input.lastError,
            updatedAt: input.updatedAt
          }
        });
    }
  };
}

function mapShop(row: typeof shops.$inferSelect): Shop {
  return {
    id: row.id,
    name: row.name,
    wbToken: row.wbToken,
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
