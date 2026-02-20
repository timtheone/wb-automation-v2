import type { Bot } from "grammy";
import { describe, expect, it, vi } from "vitest";

import type { BackendClient } from "../backend-client.js";
import type { BotContext } from "../bot-types.js";
import { createTranslator } from "../i18n/index.js";
import { registerShopsCommand } from "./shops-command.js";

function createHarness() {
  const commandHandlers = new Map<string, (ctx: BotContext) => Promise<void>>();
  const callbackHandlers: Array<{
    trigger: string | RegExp;
    handler: (ctx: BotContext) => Promise<void>;
  }> = [];
  const eventHandlers = new Map<string, (ctx: BotContext) => Promise<void>>();

  const bot = {
    command(name: string, callback: (ctx: BotContext) => Promise<void>) {
      commandHandlers.set(name, callback);
    },
    callbackQuery(trigger: string | RegExp, callback: (ctx: BotContext) => Promise<void>) {
      callbackHandlers.push({ trigger, handler: callback });
    },
    on(eventName: string, callback: (ctx: BotContext) => Promise<void>) {
      eventHandlers.set(eventName, callback);
    }
  } as unknown as Bot<BotContext>;

  function command(name: string) {
    const handler = commandHandlers.get(name);

    if (!handler) {
      throw new Error(`Command handler not found: ${name}`);
    }

    return handler;
  }

  function callback(trigger: string) {
    const exact = callbackHandlers.find((entry) => entry.trigger === trigger);

    if (exact) {
      return exact.handler;
    }

    throw new Error(`Callback handler not found: ${trigger}`);
  }

  function event(name: string) {
    const handler = eventHandlers.get(name);

    if (!handler) {
      throw new Error(`Event handler not found: ${name}`);
    }

    return handler;
  }

  return { bot, command, callback, event };
}

function createContext() {
  const reply = vi.fn<(text: string) => Promise<void>>(async () => undefined);
  const answerCallbackQuery = vi.fn(async () => undefined);

  const ctx = {
    update: { update_id: 1 },
    chat: { id: 700, type: "private" },
    from: { id: 800, language_code: "en" },
    session: { pendingAction: null },
    t: createTranslator("en"),
    reply,
    answerCallbackQuery,
    message: { text: "" },
    match: []
  } as unknown as BotContext;

  return { ctx, reply, answerCallbackQuery };
}

describe("shops command", () => {
  it("opens shops menu and resets pending action", async () => {
    const harness = createHarness();
    const backend = {} as BackendClient;

    registerShopsCommand(harness.bot, backend);

    const { ctx, reply } = createContext();
    ctx.session.pendingAction = {
      kind: "rename",
      shopId: "shop-1"
    };

    await harness.command("shops")(ctx);

    expect(ctx.session.pendingAction).toBeNull();
    expect(reply).toHaveBeenCalledWith(ctx.t.shops.menuTitle(), expect.any(Object));
  });

  it("starts create flow from callback and walks through successful shop creation", async () => {
    const harness = createHarness();
    const createdShop = {
      id: "shop-1",
      name: "Toy Store",
      wbToken: "prod-token-123",
      wbSandboxToken: null,
      useSandbox: false,
      isActive: true,
      supplyPrefix: "игрушки_",
      tokenUpdatedAt: "2026-02-20T10:00:00.000Z",
      createdAt: "2026-02-20T10:00:00.000Z",
      updatedAt: "2026-02-20T10:00:00.000Z"
    };

    const backend = {
      POST: vi.fn(async () => ({
        data: {
          shop: createdShop
        }
      })),
      GET: vi.fn(async () => ({
        data: {
          shops: [createdShop]
        }
      }))
    } as unknown as BackendClient;

    registerShopsCommand(harness.bot, backend);

    const { ctx, reply, answerCallbackQuery } = createContext();
    await harness.callback("shops:create")(ctx);

    expect(answerCallbackQuery).toHaveBeenCalledTimes(1);
    expect(ctx.session.pendingAction).toEqual({
      kind: "create",
      step: "name",
      draft: {}
    });

    const onMessage = harness.event("message:text");

    setMessageText(ctx, "Toy Store");
    await onMessage(ctx);
    expect(ctx.session.pendingAction).toMatchObject({ kind: "create", step: "wbToken" });

    setMessageText(ctx, "prod-token-123");
    await onMessage(ctx);
    expect(ctx.session.pendingAction).toMatchObject({ kind: "create", step: "supplyPrefix" });

    setMessageText(ctx, "-");
    await onMessage(ctx);
    expect(ctx.session.pendingAction).toMatchObject({ kind: "create", step: "useSandbox" });

    setMessageText(ctx, "no");
    await onMessage(ctx);
    expect(ctx.session.pendingAction).toMatchObject({ kind: "create", step: "isActive" });

    setMessageText(ctx, "yes");
    await onMessage(ctx);

    expect(ctx.session.pendingAction).toBeNull();
    expect(backend.POST).toHaveBeenCalledWith("/shops", {
      params: {
        header: expect.objectContaining({
          "x-telegram-chat-id": "700",
          "x-telegram-owner-user-id": "800"
        })
      },
      body: {
        name: "Toy Store",
        wbToken: "prod-token-123",
        isActive: true
      }
    });
    expect(backend.GET).toHaveBeenCalledWith("/shops", {
      params: {
        header: expect.objectContaining({
          "x-telegram-chat-id": "700"
        })
      }
    });
    expect(
      (reply.mock.calls as Array<[string]>).some(([text]) =>
        text.includes(ctx.t.shops.shopCreated({ name: "Toy Store" }))
      )
    ).toBe(true);
  });
});

function setMessageText(ctx: BotContext, text: string) {
  (ctx as { message: { text: string } }).message = { text };
}
