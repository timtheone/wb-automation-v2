import type { Bot } from "grammy";
import { describe, expect, it, vi } from "vitest";

import type { BotContext } from "../bot-types.js";
import { createTranslator } from "../i18n/index.js";
import { registerCancelCommand } from "./cancel-command.js";
import { registerHelpCommand } from "./help-command.js";
import { registerPingCommand } from "./ping-command.js";
import { registerStartCommand } from "./start-command.js";

function createCommandHarness() {
  const handlers = new Map<string, (ctx: BotContext) => Promise<void>>();

  const bot = {
    command(name: string, callback: (ctx: BotContext) => Promise<void>) {
      handlers.set(name, callback);
    }
  } as unknown as Bot<BotContext>;

  function getHandler(commandName: string): (ctx: BotContext) => Promise<void> {
    const handler = handlers.get(commandName);

    if (!handler) {
      throw new Error(`Command handler not registered: ${commandName}`);
    }

    return handler;
  }

  return { bot, getHandler };
}

function createContext(overrides: Partial<BotContext> = {}) {
  const reply = vi.fn<(text: string) => Promise<void>>(async () => undefined);

  const base = {
    update: { update_id: 123 },
    chat: { id: 1, type: "private" },
    from: { id: 2, language_code: "en" },
    session: {
      pendingAction: null
    },
    t: createTranslator("en"),
    reply
  } as unknown as BotContext;

  return {
    ctx: {
      ...base,
      ...overrides
    } as BotContext,
    reply
  };
}

describe("basic bot commands", () => {
  it("responds to /start with command list", async () => {
    const harness = createCommandHarness();
    registerStartCommand(harness.bot);

    const { ctx, reply } = createContext();
    await harness.getHandler("start")(ctx);

    expect(reply).toHaveBeenCalledTimes(1);
    const text = String(reply.mock.calls[0]?.[0] ?? "");
    expect(text).toContain("/process_all_shops");
    expect(text).toContain("/sync_content_shops");
    expect(text).toContain("/cancel");
  });

  it("responds to /help with operator guidance", async () => {
    const harness = createCommandHarness();
    registerHelpCommand(harness.bot);

    const { ctx, reply } = createContext();
    await harness.getHandler("help")(ctx);

    expect(reply).toHaveBeenCalledTimes(1);
    const text = String(reply.mock.calls[0]?.[0] ?? "");
    expect(text).toContain("/shops");
    expect(text).toContain("/process_all_shops");
    expect(text).toContain("/generate_pdfs");
  });

  it("responds to /ping", async () => {
    const harness = createCommandHarness();
    registerPingCommand(harness.bot);

    const { ctx, reply } = createContext();
    await harness.getHandler("ping")(ctx);

    expect(reply).toHaveBeenCalledWith("pong");
  });

  it("handles /cancel when no active input flow exists", async () => {
    const harness = createCommandHarness();
    registerCancelCommand(harness.bot);

    const { ctx, reply } = createContext();
    await harness.getHandler("cancel")(ctx);

    expect(reply).toHaveBeenCalledWith("No active input flow.");
  });

  it("clears pending action on /cancel", async () => {
    const harness = createCommandHarness();
    registerCancelCommand(harness.bot);

    const { ctx, reply } = createContext({
      session: {
        pendingAction: {
          kind: "rename",
          shopId: "shop-1"
        }
      }
    });

    await harness.getHandler("cancel")(ctx);

    expect(ctx.session.pendingAction).toBeNull();
    expect(reply).toHaveBeenCalledWith("Cancelled.");
  });
});
