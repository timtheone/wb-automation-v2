import type { Context, SessionFlavor } from "grammy";

import type { BackendPaths } from "./backend-client.js";
import type { BotLocale, BotTranslator } from "./i18n/index.js";

export type PendingAction =
  | {
      kind: "create";
      step: "name" | "wbToken" | "supplyPrefix" | "useSandbox" | "wbSandboxToken" | "isActive";
      draft: {
        name?: string;
        wbToken?: string;
        supplyPrefix?: string;
        useSandbox?: boolean;
        wbSandboxToken?: string;
      };
    }
  | {
      kind: "rename";
      shopId: string;
    }
  | {
      kind: "prefix";
      shopId: string;
    }
  | {
      kind: "token";
      shopId: string;
      tokenType: "production" | "sandbox";
    };

export type BotSession = {
  pendingAction: PendingAction | null;
};

export type BotContext = Context &
  SessionFlavor<BotSession> & {
    locale: BotLocale;
    t: BotTranslator;
  };

export type ShopDto =
  BackendPaths["/shops"]["get"]["responses"][200]["content"]["application/json"]["shops"][number];

export type ProcessAllShopsResultDto =
  BackendPaths["/flows/process-all-shops"]["post"]["responses"][200]["content"]["application/json"];

export type SyncContentShopsResultDto =
  BackendPaths["/flows/sync-content-shops"]["post"]["responses"][200]["content"]["application/json"];

export type CreateShopBody =
  NonNullable<BackendPaths["/shops"]["post"]["requestBody"]>["content"]["application/json"];
