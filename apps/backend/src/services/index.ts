import {
  createBackendFlowsService,
  type BackendFlowsService
} from "./flows-service.js";
import {
  createBackendShopsService,
  type BackendShopsService
} from "./shops-service.js";

export interface BackendServices {
  shopsService: BackendShopsService;
  flowsService: BackendFlowsService;
}

export function createBackendServices(): BackendServices {
  return {
    shopsService: createBackendShopsService(),
    flowsService: createBackendFlowsService()
  };
}
