import {
  createProcessAllShopsService,
  createSyncContentShopsService,
  type ProcessAllShopsResult,
  type SyncContentShopsResult
} from "@wb-automation-v2/core";
import { getDatabase } from "@wb-automation-v2/db";

export interface BackendFlowsService {
  processAllShops(tenantId: string): Promise<ProcessAllShopsResult>;
  syncContentShops(tenantId: string): Promise<SyncContentShopsResult>;
}

export function createBackendFlowsService(): BackendFlowsService {
  const db = getDatabase();

  return {
    processAllShops(tenantId) {
      return createProcessAllShopsService({ db, tenantId }).processAllShops();
    },
    syncContentShops(tenantId) {
      return createSyncContentShopsService({ db, tenantId }).syncContentShops();
    }
  };
}
