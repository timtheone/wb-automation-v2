import { InlineKeyboard, type Bot } from "grammy";

import { BackendApiHttpError } from "../backend-client.js";
import type { BackendClient } from "../backend-client.js";
import type { BotContext, CreateShopBody, PendingAction, ShopDto } from "../bot-types.js";
import type { BotTranslator } from "../i18n/index.js";
import {
  createBotCommandError,
  formatIsoDate,
  getTelegramContextHeaders,
  replyWithError,
  requireResponseData
} from "./shared.js";

export function registerShopsCommand(bot: Bot<BotContext>, backend: BackendClient) {
  bot.command("shops", async (ctx) => {
    ctx.session.pendingAction = null;
    await ctx.reply(ctx.t.shops.menuTitle(), {
      reply_markup: getShopsMenuKeyboard(ctx.t)
    });
  });

  bot.callbackQuery("shops:menu", async (ctx) => {
    await safeAnswerCallback(ctx);
    ctx.session.pendingAction = null;
    await ctx.reply(ctx.t.shops.menuTitle(), {
      reply_markup: getShopsMenuKeyboard(ctx.t)
    });
  });

  bot.callbackQuery("shops:list", async (ctx) => {
    await safeAnswerCallback(ctx);

    try {
      await sendShopsList(ctx, backend);
    } catch (error) {
      await replyWithError(ctx, error);
    }
  });

  bot.callbackQuery("shops:create", async (ctx) => {
    await safeAnswerCallback(ctx);

    ctx.session.pendingAction = {
      kind: "create",
      step: "name",
      draft: {}
    };

    await ctx.reply(
      [
        ctx.t.shops.createFlowStarted(),
        ctx.t.shops.sendShopName(),
        ctx.t.shops.useCancelToAbort()
      ].join("\n")
    );
  });

  bot.callbackQuery(/^shops:view:(.+)$/, async (ctx) => {
    await safeAnswerCallback(ctx);
    const shopId = requireMatchValue(ctx.match[1]);

    try {
      await sendShopDetails(ctx, backend, shopId);
    } catch (error) {
      await replyWithError(ctx, error);
    }
  });

  bot.callbackQuery(/^shops:ren:(.+)$/, async (ctx) => {
    await safeAnswerCallback(ctx);
    const shopId = requireMatchValue(ctx.match[1]);

    ctx.session.pendingAction = {
      kind: "rename",
      shopId
    };

    await ctx.reply(ctx.t.shops.sendNewShopName());
  });

  bot.callbackQuery(/^shops:pref:(.+)$/, async (ctx) => {
    await safeAnswerCallback(ctx);
    const shopId = requireMatchValue(ctx.match[1]);

    ctx.session.pendingAction = {
      kind: "prefix",
      shopId
    };

    await ctx.reply(ctx.t.shops.sendNewSupplyPrefix());
  });

  bot.callbackQuery(/^shops:tokp:(.+)$/, async (ctx) => {
    await safeAnswerCallback(ctx);
    const shopId = requireMatchValue(ctx.match[1]);

    ctx.session.pendingAction = {
      kind: "token",
      shopId,
      tokenType: "production"
    };

    await ctx.reply(ctx.t.shops.sendNewProductionToken());
  });

  bot.callbackQuery(/^shops:toks:(.+)$/, async (ctx) => {
    await safeAnswerCallback(ctx);
    const shopId = requireMatchValue(ctx.match[1]);

    ctx.session.pendingAction = {
      kind: "token",
      shopId,
      tokenType: "sandbox"
    };

    await ctx.reply(ctx.t.shops.sendNewSandboxToken());
  });

  bot.callbackQuery(/^shops:act:(.+)$/, async (ctx) => {
    await safeAnswerCallback(ctx);
    const shopId = requireMatchValue(ctx.match[1]);

    try {
      const shop = await findShopById(ctx, backend, shopId);
      const response = await backend.PATCH("/shops/{id}", {
        params: {
          path: { id: shopId },
          header: await getTelegramContextHeaders(ctx)
        },
        body: { isActive: !shop.isActive }
      });
      const updated = requireResponseData(response.data, "PATCH /shops/{id}").shop;
      await ctx.reply(
        ctx.t.shops.shopNowStatus({
          name: updated.name,
          status: updated.isActive ? ctx.t.shops.state.active() : ctx.t.shops.state.inactive()
        })
      );
      await sendShopDetails(ctx, backend, shopId);
    } catch (error) {
      await replyWithError(ctx, error);
    }
  });

  bot.callbackQuery(/^shops:sbx:(.+)$/, async (ctx) => {
    await safeAnswerCallback(ctx);
    const shopId = requireMatchValue(ctx.match[1]);

    try {
      const shop = await findShopById(ctx, backend, shopId);
      const response = await backend.PATCH("/shops/{id}", {
        params: {
          path: { id: shopId },
          header: await getTelegramContextHeaders(ctx)
        },
        body: { useSandbox: !shop.useSandbox }
      });
      const updated = requireResponseData(response.data, "PATCH /shops/{id}").shop;
      await ctx.reply(
        ctx.t.shops.shopModeNow({
          name: updated.name,
          mode: updated.useSandbox ? ctx.t.shops.state.sandbox() : ctx.t.shops.state.production()
        })
      );
      await sendShopDetails(ctx, backend, shopId);
    } catch (error) {
      await replyWithError(ctx, error);
    }
  });

  bot.callbackQuery(/^shops:del:(.+)$/, async (ctx) => {
    await safeAnswerCallback(ctx);
    const shopId = requireMatchValue(ctx.match[1]);

    try {
      const response = await backend.DELETE("/shops/{id}", {
        params: {
          path: { id: shopId },
          header: await getTelegramContextHeaders(ctx)
        }
      });
      const updated = requireResponseData(response.data, "DELETE /shops/{id}").shop;
      await ctx.reply(ctx.t.shops.shopDeactivated({ name: updated.name }));
      await sendShopsList(ctx, backend);
    } catch (error) {
      await replyWithError(ctx, error);
    }
  });

  bot.on("message:text", async (ctx) => {
    const pending = ctx.session.pendingAction;

    if (!pending) {
      return;
    }

    const text = ctx.message.text.trim();

    if (!text || text.startsWith("/")) {
      return;
    }

    try {
      if (pending.kind === "create") {
        await handleCreateFlowStep(ctx, text, pending, backend);
        return;
      }

      if (pending.kind === "rename") {
        const normalized = requireNonEmpty(text, "name");
        try {
          const response = await backend.PATCH("/shops/{id}", {
            params: {
              path: { id: pending.shopId },
              header: await getTelegramContextHeaders(ctx)
            },
            body: { name: normalized }
          });
          const updated = requireResponseData(response.data, "PATCH /shops/{id}").shop;
          ctx.session.pendingAction = null;
          await ctx.reply(ctx.t.shops.shopRenamed({ name: updated.name }));
          await sendShopDetails(ctx, backend, pending.shopId);
          return;
        } catch (error) {
          if (error instanceof BackendApiHttpError && error.status === 409) {
            const details = error.details as { code?: string } | undefined;
            if (details?.code === "SHOP_NAME_ALREADY_EXISTS") {
              await ctx.reply(ctx.t.shops.duplicateNameRetry());
              return;
            }
          }
          throw error;
        }
      }

      if (pending.kind === "prefix") {
        const normalized = requireNonEmpty(text, "supplyPrefix");
        const response = await backend.PATCH("/shops/{id}", {
          params: {
            path: { id: pending.shopId },
            header: await getTelegramContextHeaders(ctx)
          },
          body: { supplyPrefix: normalized }
        });
        const updated = requireResponseData(response.data, "PATCH /shops/{id}").shop;
        ctx.session.pendingAction = null;
        await ctx.reply(ctx.t.shops.supplyPrefixUpdated({ name: updated.name }));
        await sendShopDetails(ctx, backend, pending.shopId);
        return;
      }

      if (pending.kind === "token") {
        const token = requireNonEmpty(text, "wbToken");
        const response = await backend.PATCH("/shops/{id}/token", {
          params: {
            path: { id: pending.shopId },
            header: await getTelegramContextHeaders(ctx)
          },
          body: {
            wbToken: token,
            tokenType: pending.tokenType
          }
        });
        const updated = requireResponseData(response.data, "PATCH /shops/{id}/token").shop;
        ctx.session.pendingAction = null;
        await ctx.reply(
          pending.tokenType === "sandbox"
            ? ctx.t.shops.sandboxTokenUpdated({ name: updated.name })
            : ctx.t.shops.productionTokenUpdated({ name: updated.name })
        );
        await sendShopDetails(ctx, backend, pending.shopId);
      }
    } catch (error) {
      await replyWithError(ctx, error);
    }
  });
}

async function sendShopsList(ctx: BotContext, backend: BackendClient) {
  const shops = await listShops(ctx, backend);

  if (shops.length === 0) {
    await ctx.reply(ctx.t.shops.noShopsConfiguredYet(), {
      reply_markup: getShopsMenuKeyboard(ctx.t)
    });
    return;
  }

  await ctx.reply(formatShopsList(ctx.t, shops), {
    reply_markup: getShopsListKeyboard(ctx.t, shops)
  });
}

async function sendShopDetails(ctx: BotContext, backend: BackendClient, shopId: string) {
  const shop = await findShopById(ctx, backend, shopId);

  await ctx.reply(formatShopDetails(ctx.t, shop), {
    reply_markup: getShopActionsKeyboard(ctx.t, shop)
  });
}

async function listShops(ctx: BotContext, backend: BackendClient): Promise<ShopDto[]> {
  const response = await backend.GET("/shops", {
    params: {
      header: await getTelegramContextHeaders(ctx)
    }
  });
  const payload = requireResponseData(response.data, "GET /shops");
  return payload.shops;
}

async function findShopById(
  ctx: BotContext,
  backend: BackendClient,
  shopId: string
): Promise<ShopDto> {
  const shops = await listShops(ctx, backend);
  const shop = shops.find((item) => item.id === shopId);

  if (!shop) {
    throw createBotCommandError("SHOP_NOT_FOUND", { shopId });
  }

  return shop;
}

async function handleCreateFlowStep(
  ctx: BotContext,
  text: string,
  pending: Extract<PendingAction, { kind: "create" }>,
  backend: BackendClient
) {
  if (pending.step === "name") {
    const name = requireNonEmpty(text, "name");

    try {
      const response = await backend.GET("/shops/check-name", {
        params: {
          query: { name },
          header: await getTelegramContextHeaders(ctx)
        }
      });

      if (response.error) {
        throw response.error;
      }

      pending.draft.name = name;
      pending.step = "wbToken";
      await ctx.reply(ctx.t.shops.sendProductionToken());
      return;
    } catch (error) {
      if (error instanceof BackendApiHttpError && error.status === 409) {
        const details = error.details as { code?: string } | undefined;
        if (details?.code === "SHOP_NAME_ALREADY_EXISTS") {
          await ctx.reply(ctx.t.shops.duplicateNameRetry());
          return;
        }
      }
      throw error;
    }
  }

  if (pending.step === "wbToken") {
    pending.draft.wbToken = requireNonEmpty(text, "wbToken");
    pending.step = "supplyPrefix";
    await ctx.reply(ctx.t.shops.sendSupplyPrefixOrDefault());
    return;
  }

  if (pending.step === "supplyPrefix") {
    pending.draft.supplyPrefix = normalizeOptionalValue(text);
    pending.step = "useSandbox";
    await ctx.reply(ctx.t.shops.useSandboxQuestion());
    return;
  }

  if (pending.step === "useSandbox") {
    const useSandbox = parseBooleanInput(text);

    if (useSandbox === null) {
      await ctx.reply(ctx.t.shops.replyYesOrNo());
      return;
    }

    pending.draft.useSandbox = useSandbox;

    if (useSandbox) {
      pending.step = "wbSandboxToken";
      await ctx.reply(ctx.t.shops.sendSandboxToken());
      return;
    }

    pending.step = "isActive";
    await ctx.reply(ctx.t.shops.shouldBeActiveQuestion());
    return;
  }

  if (pending.step === "wbSandboxToken") {
    pending.draft.wbSandboxToken = requireNonEmpty(text, "wbSandboxToken");
    pending.step = "isActive";
    await ctx.reply(ctx.t.shops.shouldBeActiveQuestion());
    return;
  }

  if (pending.step !== "isActive") {
    return;
  }

  const isActive = parseBooleanInput(text);

  if (isActive === null) {
    await ctx.reply(ctx.t.shops.replyYesOrNo());
    return;
  }

  const name = pending.draft.name;
  const wbToken = pending.draft.wbToken;

  if (!name || !wbToken) {
    throw createBotCommandError("CREATE_FLOW_REQUIRED_FIELDS_MISSING");
  }

  const createBody: CreateShopBody = {
    name,
    wbToken,
    ...(pending.draft.supplyPrefix ? { supplyPrefix: pending.draft.supplyPrefix } : {}),
    ...(pending.draft.useSandbox ? { useSandbox: true } : {}),
    ...(pending.draft.wbSandboxToken ? { wbSandboxToken: pending.draft.wbSandboxToken } : {}),
    isActive
  };

  try {
    const response = await backend.POST("/shops", {
      params: {
        header: await getTelegramContextHeaders(ctx)
      },
      body: createBody
    });
    const created = requireResponseData(response.data, "POST /shops").shop;

    ctx.session.pendingAction = null;
    await ctx.reply(ctx.t.shops.shopCreated({ name: created.name }));
    await sendShopDetails(ctx, backend, created.id);
  } catch (error) {
    if (error instanceof BackendApiHttpError && error.status === 409) {
      const details = error.details as { code?: string } | undefined;
      if (details?.code === "SHOP_NAME_ALREADY_EXISTS") {
        pending.step = "name";
        pending.draft = {};
        await ctx.reply(ctx.t.shops.duplicateNameRetry());
        return;
      }
    }
    throw error;
  }
}

function getShopsMenuKeyboard(t: BotTranslator): InlineKeyboard {
  return new InlineKeyboard()
    .text(t.shops.buttons.listShops(), "shops:list")
    .row()
    .text(t.shops.buttons.createShop(), "shops:create");
}

function getShopsListKeyboard(t: BotTranslator, shops: ShopDto[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  for (const shop of shops) {
    keyboard.text(
      trimForButton(`${shop.name}${shop.isActive ? "" : ` (${t.shops.state.inactive()})`}`),
      `shops:view:${shop.id}`
    );
    keyboard.row();
  }

  keyboard.text(t.shops.buttons.createShop(), "shops:create");
  keyboard.row();
  keyboard.text(t.shops.buttons.menu(), "shops:menu");

  return keyboard;
}

function getShopActionsKeyboard(t: BotTranslator, shop: ShopDto): InlineKeyboard {
  return new InlineKeyboard()
    .text(t.shops.buttons.rename(), `shops:ren:${shop.id}`)
    .text(t.shops.buttons.updatePrefix(), `shops:pref:${shop.id}`)
    .row()
    .text(t.shops.buttons.productionToken(), `shops:tokp:${shop.id}`)
    .text(t.shops.buttons.sandboxToken(), `shops:toks:${shop.id}`)
    .row()
    .text(
      shop.isActive ? t.shops.buttons.deactivate() : t.shops.buttons.activate(),
      `shops:act:${shop.id}`
    )
    .text(t.shops.buttons.toggleSandbox(), `shops:sbx:${shop.id}`)
    .row()
    .text(t.shops.buttons.backToList(), "shops:list")
    .text(t.shops.buttons.menu(), "shops:menu");
}

function formatShopsList(t: BotTranslator, shops: ShopDto[]): string {
  const lines = [t.shops.listHeader()];

  for (const [index, shop] of shops.entries()) {
    lines.push(
      t.shops.listItem({
        index: index + 1,
        name: shop.name,
        status: shop.isActive ? t.shops.state.active() : t.shops.state.inactive(),
        mode: shop.useSandbox ? t.shops.state.sandbox() : t.shops.state.production()
      })
    );
  }

  return lines.join("\n");
}

function formatShopDetails(t: BotTranslator, shop: ShopDto): string {
  return [
    `${t.shops.details.shop()}: ${shop.name}`,
    `${t.shops.details.id()}: ${shop.id}`,
    `${t.shops.details.status()}: ${shop.isActive ? t.shops.state.active() : t.shops.state.inactive()}`,
    `${t.shops.details.mode()}: ${shop.useSandbox ? t.shops.state.sandbox() : t.shops.state.production()}`,
    `${t.shops.details.supplyPrefix()}: ${shop.supplyPrefix}`,
    `${t.shops.details.productionToken()}: ${maskToken(shop.wbToken)}`,
    `${t.shops.details.sandboxToken()}: ${shop.wbSandboxToken ? maskToken(shop.wbSandboxToken) : t.shops.state.notSet()}`,
    `${t.shops.details.tokenUpdated()}: ${formatIsoDate(shop.tokenUpdatedAt)}`
  ].join("\n");
}

async function safeAnswerCallback(ctx: BotContext) {
  try {
    await ctx.answerCallbackQuery();
  } catch {
    // ignore callback answer races
  }
}

function requireMatchValue(value: string | undefined): string {
  if (!value) {
    throw createBotCommandError("INVALID_CALLBACK_PAYLOAD");
  }

  return value;
}

function requireNonEmpty(value: string, field: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw createBotCommandError("FIELD_MUST_NOT_BE_EMPTY", { field });
  }

  return normalized;
}

function normalizeOptionalValue(value: string): string | undefined {
  const normalized = value.trim();

  if (!normalized || normalized === "-") {
    return undefined;
  }

  return normalized;
}

function parseBooleanInput(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();

  if (["y", "yes", "true", "1", "d", "da", "д", "да"].includes(normalized)) {
    return true;
  }

  if (["n", "no", "false", "0", "net", "н", "нет"].includes(normalized)) {
    return false;
  }

  return null;
}

function trimForButton(value: string, maxLength = 32): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function maskToken(token: string): string {
  if (token.length <= 8) {
    return "*".repeat(token.length);
  }

  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}
