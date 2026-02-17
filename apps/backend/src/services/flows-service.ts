import {
  createProcessAllShopsService,
  createSyncContentShopsService,
  type ProcessAllShopsResult,
  type SyncContentShopsResult
} from "@wb-automation-v2/core";
import { getDatabase } from "@wb-automation-v2/db";

export interface BackendFlowsService {
  processAllShops(): Promise<ProcessAllShopsResult>;
  syncContentShops(): Promise<SyncContentShopsResult>;
}

export function createBackendFlowsService(): BackendFlowsService {
  const db = getDatabase();
  const processAllShopsService = createProcessAllShopsService({ db });
  const syncContentShopsService = createSyncContentShopsService({});

  return {
    processAllShops() {
      return processAllShopsService.processAllShops();
    },
    syncContentShops() {
      return syncContentShopsService.syncContentShops();
    }
  };
}
