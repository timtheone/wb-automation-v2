import type { Bot } from "grammy";
import { describe, expect, it, vi } from "vitest";

import type { BackendClient } from "../backend-client.js";
import type { BotContext } from "../bot-types.js";
import { createTranslator } from "../i18n/index.js";
import { registerGeneratePdfsCommand } from "./generate-pdfs-command.js";
import { registerGenerateWaitingOrdersPdfCommand } from "./generate-waiting-orders-pdf-command.js";
import { registerSyncContentShopsCommand } from "./sync-content-shops-command.js";

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

function createContext() {
  const reply = vi.fn<(text: string) => Promise<void>>(async () => undefined);

  const ctx = {
    update: {
      update_id: 111
    },
    chat: {
      id: 500,
      type: "private"
    },
    from: {
      id: 900,
      language_code: "en"
    },
    session: {
      pendingAction: null
    },
    t: createTranslator("en"),
    reply
  } as unknown as BotContext;

  return { ctx, reply };
}

describe("async flow bot commands", () => {
  it("queues /generate_pdfs and sends immediate status updates", async () => {
    const harness = createCommandHarness();
    const backend = {
      POST: vi.fn(async () => ({
        data: {
          jobId: "job-1",
          status: "queued",
          createdAt: new Date().toISOString()
        }
      }))
    } as unknown as BackendClient;

    registerGeneratePdfsCommand(harness.bot, backend);
    const handler = harness.getHandler("generate_pdfs");
    const { ctx, reply } = createContext();

    await handler(ctx);

    expect(reply).toHaveBeenNthCalledWith(1, ctx.t.flows.generatePdfs.requesting());
    expect(reply).toHaveBeenNthCalledWith(2, ctx.t.flows.generatePdfs.queued());
    expect(backend.POST).toHaveBeenCalledWith("/flows/get-combined-pdf-lists", {
      params: {
        header: {
          "x-telegram-chat-id": "500",
          "x-telegram-chat-type": "private",
          "x-telegram-user-id": "900",
          "x-telegram-owner-user-id": "900",
          "x-telegram-language-code": "en"
        }
      }
    });
  });

  it("returns already-running message for /generate_pdfs", async () => {
    const harness = createCommandHarness();
    const backend = {
      POST: vi.fn(async () => ({
        data: {
          jobId: "job-1",
          status: "running",
          createdAt: new Date().toISOString()
        }
      }))
    } as unknown as BackendClient;

    registerGeneratePdfsCommand(harness.bot, backend);
    const handler = harness.getHandler("generate_pdfs");
    const { ctx, reply } = createContext();

    await handler(ctx);

    expect(reply).toHaveBeenNthCalledWith(2, ctx.t.flows.generatePdfs.alreadyRunning());
  });

  it("queues /generate_waiting_orders_pdf", async () => {
    const harness = createCommandHarness();
    const backend = {
      POST: vi.fn(async () => ({
        data: {
          jobId: "job-2",
          status: "queued",
          createdAt: new Date().toISOString()
        }
      }))
    } as unknown as BackendClient;

    registerGenerateWaitingOrdersPdfCommand(harness.bot, backend);
    const handler = harness.getHandler("generate_waiting_orders_pdf");
    const { ctx, reply } = createContext();

    await handler(ctx);

    expect(reply).toHaveBeenNthCalledWith(1, ctx.t.flows.generateWaitingOrdersPdf.requesting());
    expect(reply).toHaveBeenNthCalledWith(2, ctx.t.flows.generateWaitingOrdersPdf.queued());
    expect(backend.POST).toHaveBeenCalledWith("/flows/get-waiting-orders-pdf", {
      params: {
        header: expect.objectContaining({
          "x-telegram-chat-id": "500",
          "x-telegram-owner-user-id": "900"
        })
      }
    });
  });

  it("returns already-running message for /sync_content_shops", async () => {
    const harness = createCommandHarness();
    const backend = {
      POST: vi.fn(async () => ({
        data: {
          jobId: "job-3",
          status: "running",
          createdAt: new Date().toISOString()
        }
      }))
    } as unknown as BackendClient;

    registerSyncContentShopsCommand(harness.bot, backend);
    const handler = harness.getHandler("sync_content_shops");
    const { ctx, reply } = createContext();

    await handler(ctx);

    expect(reply).toHaveBeenNthCalledWith(1, ctx.t.flows.syncContent.running());
    expect(reply).toHaveBeenNthCalledWith(2, ctx.t.flows.syncContent.alreadyRunning());
    expect(backend.POST).toHaveBeenCalledWith("/flows/sync-content-shops/async", {
      params: {
        header: expect.objectContaining({
          "x-telegram-chat-id": "500",
          "x-telegram-user-id": "900"
        })
      }
    });
  });

  it("queues /sync_content_shops in background", async () => {
    const harness = createCommandHarness();
    const backend = {
      POST: vi.fn(async () => ({
        data: {
          jobId: "job-4",
          status: "queued",
          createdAt: new Date().toISOString()
        }
      }))
    } as unknown as BackendClient;

    registerSyncContentShopsCommand(harness.bot, backend);
    const handler = harness.getHandler("sync_content_shops");
    const { ctx, reply } = createContext();

    await handler(ctx);

    expect(reply).toHaveBeenNthCalledWith(2, ctx.t.flows.syncContent.queued());
  });
});
