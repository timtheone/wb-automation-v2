import { InlineKeyboard, type Bot } from "grammy";

import type { BackendClient } from "../backend-client.js";
import type { BotContext, CreateShopBody, PendingAction, ShopDto } from "../bot-types.js";
import { formatIsoDate, getTelegramContextHeaders, replyWithError, requireResponseData } from "./shared.js";

export function registerShopsCommand(bot: Bot<BotContext>, backend: BackendClient) {
  bot.command("shops", async (ctx) => {
    ctx.session.pendingAction = null;
    await ctx.reply("Shops menu", {
      reply_markup: getShopsMenuKeyboard()
    });
  });

  bot.callbackQuery("shops:menu", async (ctx) => {
    await safeAnswerCallback(ctx);
    ctx.session.pendingAction = null;
    await ctx.reply("Shops menu", {
      reply_markup: getShopsMenuKeyboard()
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

    await ctx.reply(["Create shop flow started.", "Send shop name.", "Use /cancel to abort."].join("\n"));
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

    await ctx.reply("Send new shop name.");
  });

  bot.callbackQuery(/^shops:pref:(.+)$/, async (ctx) => {
    await safeAnswerCallback(ctx);
    const shopId = requireMatchValue(ctx.match[1]);

    ctx.session.pendingAction = {
      kind: "prefix",
      shopId
    };

    await ctx.reply("Send new supply prefix.");
  });

  bot.callbackQuery(/^shops:tokp:(.+)$/, async (ctx) => {
    await safeAnswerCallback(ctx);
    const shopId = requireMatchValue(ctx.match[1]);

    ctx.session.pendingAction = {
      kind: "token",
      shopId,
      tokenType: "production"
    };

    await ctx.reply("Send new production WB token.");
  });

  bot.callbackQuery(/^shops:toks:(.+)$/, async (ctx) => {
    await safeAnswerCallback(ctx);
    const shopId = requireMatchValue(ctx.match[1]);

    ctx.session.pendingAction = {
      kind: "token",
      shopId,
      tokenType: "sandbox"
    };

    await ctx.reply("Send new sandbox WB token.");
  });

  bot.callbackQuery(/^shops:act:(.+)$/, async (ctx) => {
    await safeAnswerCallback(ctx);
    const shopId = requireMatchValue(ctx.match[1]);

    try {
      const shop = await findShopById(ctx, backend, shopId);
      const response = await backend.PATCH(
        "/shops/{id}",
        {
          params: {
            path: { id: shopId },
            header: await getTelegramContextHeaders(ctx)
          },
          body: { isActive: !shop.isActive }
        }
      );
      const updated = requireResponseData(response.data, "PATCH /shops/{id}").shop;
      await ctx.reply(`Shop ${updated.name} is now ${updated.isActive ? "active" : "inactive"}.`);
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
      const response = await backend.PATCH(
        "/shops/{id}",
        {
          params: {
            path: { id: shopId },
            header: await getTelegramContextHeaders(ctx)
          },
          body: { useSandbox: !shop.useSandbox }
        }
      );
      const updated = requireResponseData(response.data, "PATCH /shops/{id}").shop;
      await ctx.reply(`Shop ${updated.name} mode is now ${updated.useSandbox ? "sandbox" : "production"}.`);
      await sendShopDetails(ctx, backend, shopId);
    } catch (error) {
      await replyWithError(ctx, error);
    }
  });

  bot.callbackQuery(/^shops:del:(.+)$/, async (ctx) => {
    await safeAnswerCallback(ctx);
    const shopId = requireMatchValue(ctx.match[1]);

    try {
      const response = await backend.DELETE(
        "/shops/{id}",
        {
          params: {
            path: { id: shopId },
            header: await getTelegramContextHeaders(ctx)
          }
        }
      );
      const updated = requireResponseData(response.data, "DELETE /shops/{id}").shop;
      await ctx.reply(`Shop ${updated.name} was deactivated.`);
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
        const response = await backend.PATCH(
          "/shops/{id}",
          {
            params: {
              path: { id: pending.shopId },
              header: await getTelegramContextHeaders(ctx)
            },
            body: { name: normalized }
          }
        );
        const updated = requireResponseData(response.data, "PATCH /shops/{id}").shop;
        ctx.session.pendingAction = null;
        await ctx.reply(`Shop renamed to ${updated.name}.`);
        await sendShopDetails(ctx, backend, pending.shopId);
        return;
      }

      if (pending.kind === "prefix") {
        const normalized = requireNonEmpty(text, "supplyPrefix");
        const response = await backend.PATCH(
          "/shops/{id}",
          {
            params: {
              path: { id: pending.shopId },
              header: await getTelegramContextHeaders(ctx)
            },
            body: { supplyPrefix: normalized }
          }
        );
        const updated = requireResponseData(response.data, "PATCH /shops/{id}").shop;
        ctx.session.pendingAction = null;
        await ctx.reply(`Supply prefix updated for ${updated.name}.`);
        await sendShopDetails(ctx, backend, pending.shopId);
        return;
      }

      if (pending.kind === "token") {
        const token = requireNonEmpty(text, "wbToken");
        const response = await backend.PATCH(
          "/shops/{id}/token",
          {
            params: {
              path: { id: pending.shopId },
              header: await getTelegramContextHeaders(ctx)
            },
            body: {
              wbToken: token,
              tokenType: pending.tokenType
            }
          }
        );
        const updated = requireResponseData(response.data, "PATCH /shops/{id}/token").shop;
        ctx.session.pendingAction = null;
        await ctx.reply(
          `${pending.tokenType === "sandbox" ? "Sandbox" : "Production"} token updated for ${updated.name}.`
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
    await ctx.reply("No shops configured yet.", {
      reply_markup: getShopsMenuKeyboard()
    });
    return;
  }

  await ctx.reply(formatShopsList(shops), {
    reply_markup: getShopsListKeyboard(shops)
  });
}

async function sendShopDetails(ctx: BotContext, backend: BackendClient, shopId: string) {
  const shop = await findShopById(ctx, backend, shopId);

  await ctx.reply(formatShopDetails(shop), {
    reply_markup: getShopActionsKeyboard(shop.id)
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

async function findShopById(ctx: BotContext, backend: BackendClient, shopId: string): Promise<ShopDto> {
  const shops = await listShops(ctx, backend);
  const shop = shops.find((item) => item.id === shopId);

  if (!shop) {
    throw new Error(`Shop not found: ${shopId}`);
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
    pending.draft.name = requireNonEmpty(text, "name");
    pending.step = "wbToken";
    await ctx.reply("Send production WB token.");
    return;
  }

  if (pending.step === "wbToken") {
    pending.draft.wbToken = requireNonEmpty(text, "wbToken");
    pending.step = "supplyPrefix";
    await ctx.reply("Send supply prefix, or '-' to use default.");
    return;
  }

  if (pending.step === "supplyPrefix") {
    pending.draft.supplyPrefix = normalizeOptionalValue(text);
    pending.step = "useSandbox";
    await ctx.reply("Use sandbox mode? Reply yes or no.");
    return;
  }

  if (pending.step === "useSandbox") {
    const useSandbox = parseBooleanInput(text);

    if (useSandbox === null) {
      await ctx.reply("Please reply with yes or no.");
      return;
    }

    pending.draft.useSandbox = useSandbox;

    if (useSandbox) {
      pending.step = "wbSandboxToken";
      await ctx.reply("Send sandbox WB token.");
      return;
    }

    pending.step = "isActive";
    await ctx.reply("Should this shop be active now? Reply yes or no.");
    return;
  }

  if (pending.step === "wbSandboxToken") {
    pending.draft.wbSandboxToken = requireNonEmpty(text, "wbSandboxToken");
    pending.step = "isActive";
    await ctx.reply("Should this shop be active now? Reply yes or no.");
    return;
  }

  if (pending.step !== "isActive") {
    return;
  }

  const isActive = parseBooleanInput(text);

  if (isActive === null) {
    await ctx.reply("Please reply with yes or no.");
    return;
  }

  const name = pending.draft.name;
  const wbToken = pending.draft.wbToken;

  if (!name || !wbToken) {
    throw new Error("Create flow lost required fields. Please run /shops and start again.");
  }

  const createBody: CreateShopBody = {
    name,
    wbToken,
    ...(pending.draft.supplyPrefix ? { supplyPrefix: pending.draft.supplyPrefix } : {}),
    ...(pending.draft.useSandbox ? { useSandbox: true } : {}),
    ...(pending.draft.wbSandboxToken ? { wbSandboxToken: pending.draft.wbSandboxToken } : {}),
    isActive
  };

  const response = await backend.POST(
    "/shops",
    {
      params: {
        header: await getTelegramContextHeaders(ctx)
      },
      body: createBody
    }
  );
  const created = requireResponseData(response.data, "POST /shops").shop;

  ctx.session.pendingAction = null;
  await ctx.reply(`Shop created: ${created.name}`);
  await sendShopDetails(ctx, backend, created.id);
}

function getShopsMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("List shops", "shops:list").row().text("Create shop", "shops:create");
}

function getShopsListKeyboard(shops: ShopDto[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  for (const shop of shops) {
    keyboard.text(trimForButton(`${shop.name}${shop.isActive ? "" : " (inactive)"}`), `shops:view:${shop.id}`);
    keyboard.row();
  }

  keyboard.text("Create shop", "shops:create");
  keyboard.row();
  keyboard.text("Menu", "shops:menu");

  return keyboard;
}

function getShopActionsKeyboard(shopId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Rename", `shops:ren:${shopId}`)
    .text("Update prefix", `shops:pref:${shopId}`)
    .row()
    .text("Prod token", `shops:tokp:${shopId}`)
    .text("Sandbox token", `shops:toks:${shopId}`)
    .row()
    .text("Toggle active", `shops:act:${shopId}`)
    .text("Toggle sandbox", `shops:sbx:${shopId}`)
    .row()
    .text("Deactivate", `shops:del:${shopId}`)
    .row()
    .text("Back to list", "shops:list")
    .text("Menu", "shops:menu");
}

function formatShopsList(shops: ShopDto[]): string {
  const lines = ["Shops:"];

  for (const [index, shop] of shops.entries()) {
    lines.push(
      `${index + 1}. ${shop.name} | ${shop.isActive ? "active" : "inactive"} | ${
        shop.useSandbox ? "sandbox" : "production"
      }`
    );
  }

  return lines.join("\n");
}

function formatShopDetails(shop: ShopDto): string {
  return [
    `Shop: ${shop.name}`,
    `ID: ${shop.id}`,
    `Status: ${shop.isActive ? "active" : "inactive"}`,
    `Mode: ${shop.useSandbox ? "sandbox" : "production"}`,
    `Supply prefix: ${shop.supplyPrefix}`,
    `Prod token: ${maskToken(shop.wbToken)}`,
    `Sandbox token: ${shop.wbSandboxToken ? maskToken(shop.wbSandboxToken) : "not set"}`,
    `Token updated: ${formatIsoDate(shop.tokenUpdatedAt)}`
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
    throw new Error("Invalid callback payload");
  }

  return value;
}

function requireNonEmpty(value: string, field: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${field} must not be empty`);
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

  if (["y", "yes", "true", "1"].includes(normalized)) {
    return true;
  }

  if (["n", "no", "false", "0"].includes(normalized)) {
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
