import type { Bot } from "grammy";
import { describe, expect, it, vi } from "vitest";

import type { BackendClient } from "../backend-client.js";
import type { BotContext, ProcessAllShopsResultDto } from "../bot-types.js";
import { createTranslator } from "../i18n/index.js";
import { registerProcessAllShopsCommand } from "./process-all-shops-command.js";

function createResult(overrides?: Partial<ProcessAllShopsResultDto>): ProcessAllShopsResultDto {
  return {
    startedAt: "2026-02-19T10:00:00.000Z",
    finishedAt: "2026-02-19T10:01:00.000Z",
    processedShops: 1,
    successCount: 1,
    skippedCount: 0,
    failureCount: 0,
    results: [
      {
        shopId: "shop-1",
        shopName: "Shop One",
        status: "success",
        supplyId: "SUP-1",
        ordersInNew: 2,
        ordersSkippedByMeta: 0,
        ordersAttached: 2,
        barcode: "SUP-1",
        barcodeFile: "aGVsbG8=",
        error: null
      }
    ],
    ...overrides
  };
}

function createContext() {
  const reply = vi.fn<(message: string) => Promise<void>>(async () => undefined);
  const replyWithPhoto = vi.fn<(photo: unknown, options?: { caption?: string }) => Promise<void>>(
    async () => undefined
  );

  const ctx = {
    chat: {
      id: 100,
      type: "private"
    },
    from: {
      id: 200,
      language_code: "en"
    },
    session: {
      pendingAction: null
    },
    t: createTranslator("en"),
    reply,
    replyWithPhoto
  } as unknown as BotContext;

  return { ctx, reply, replyWithPhoto };
}

function requireHandler(
  handler: ((ctx: BotContext) => Promise<void>) | null
): (ctx: BotContext) => Promise<void> {
  if (!handler) {
    throw new Error("process_all_shops handler is not registered");
  }

  return handler;
}

describe("registerProcessAllShopsCommand", () => {
  it("sends shop QR code photos when barcode file is present", async () => {
    let handler: ((ctx: BotContext) => Promise<void>) | null = null;
    const bot = {
      command(command: string, callback: (ctx: BotContext) => Promise<void>) {
        if (command === "process_all_shops") {
          handler = callback;
        }
      }
    } as unknown as Bot<BotContext>;

    const backend = {
      POST: vi.fn(async () => ({
        data: createResult()
      }))
    } as unknown as BackendClient;

    registerProcessAllShopsCommand(bot, backend);
    const commandHandler = requireHandler(handler);

    const { ctx, reply, replyWithPhoto } = createContext();
    await commandHandler(ctx);

    expect(reply).toHaveBeenCalledWith("Running process_all_shops...");
    expect(
      (reply.mock.calls as Array<[unknown]>).some(([message]) =>
        typeof message === "string" ? message.includes("process_all_shops completed") : false
      )
    ).toBe(true);
    expect(replyWithPhoto).toHaveBeenCalledTimes(1);

    const [, options] = (replyWithPhoto.mock.calls as Array<[unknown, { caption?: string } | undefined]>)[0] ?? [];
    expect(options).toMatchObject({ caption: "QR code for shop Shop One" });
  });

  it("does not send QR code photos when barcode file is absent", async () => {
    let handler: ((ctx: BotContext) => Promise<void>) | null = null;
    const bot = {
      command(command: string, callback: (ctx: BotContext) => Promise<void>) {
        if (command === "process_all_shops") {
          handler = callback;
        }
      }
    } as unknown as Bot<BotContext>;

    const backend = {
      POST: vi.fn(async () => ({
        data: createResult({
          results: [
            {
              shopId: "shop-1",
              shopName: "Shop One",
              status: "success",
              supplyId: "SUP-1",
              ordersInNew: 2,
              ordersSkippedByMeta: 0,
              ordersAttached: 2,
              barcode: "SUP-1",
              barcodeFile: null,
              error: null
            }
          ]
        })
      }))
    } as unknown as BackendClient;

    registerProcessAllShopsCommand(bot, backend);
    const commandHandler = requireHandler(handler);

    const { ctx, replyWithPhoto } = createContext();
    await commandHandler(ctx);

    expect(replyWithPhoto).not.toHaveBeenCalled();
  });
});
