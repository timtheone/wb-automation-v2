import {
  createTenantChatRepository,
  createTenantRepository,
  getDatabase,
  type Database
} from "@wb-automation-v2/db";

import type { TelegramRequestContext } from "../http/telegram-context.js";

export interface BackendTenantContext extends TelegramRequestContext {
  tenantId: string;
}

export interface BackendTenantService {
  listTenantContexts(): Promise<Array<Pick<BackendTenantContext, "tenantId" | "ownerTelegramUserId">>>;
  resolveTenantContext(input: TelegramRequestContext): Promise<BackendTenantContext>;
}

export function createBackendTenantService(options: { db?: Database } = {}): BackendTenantService {
  const db = options.db ?? getDatabase();
  const tenants = createTenantRepository(db);
  const tenantChats = createTenantChatRepository(db);

  return {
    async listTenantContexts() {
      const allTenants = await tenants.listTenants();
      return allTenants.map((tenant) => ({
        tenantId: tenant.id,
        ownerTelegramUserId: tenant.ownerTelegramUserId
      }));
    },

    async resolveTenantContext(input) {
      const tenant = await tenants.getOrCreateByOwnerTelegramUserId(input.ownerTelegramUserId);

      await tenantChats.upsert({
        chatId: input.chatId,
        tenantId: tenant.id,
        ownerTelegramUserId: input.ownerTelegramUserId,
        chatType: input.chatType
      });

      return {
        ...input,
        tenantId: tenant.id
      };
    }
  };
}
