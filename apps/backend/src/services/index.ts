import {
  createBackendFlowsService,
  type BackendFlowsService
} from "./flows-service.js";
import {
  createBackendShopsService,
  type BackendShopsService
} from "./shops-service.js";
import {
  createBackendTenantService,
  type BackendTenantService
} from "./tenant-service.js";

export interface BackendServices {
  shopsService: BackendShopsService;
  flowsService: BackendFlowsService;
  tenantService: BackendTenantService;
}

export function createBackendServices(): BackendServices {
  return {
    shopsService: createBackendShopsService(),
    flowsService: createBackendFlowsService(),
    tenantService: createBackendTenantService()
  };
}
