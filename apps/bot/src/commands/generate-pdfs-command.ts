import type { Bot } from "grammy";

import type { BackendClient } from "../backend-client.js";
import type { BotContext } from "../bot-types.js";
import { getTelegramContextHeaders, replyWithError } from "./shared.js";

export function registerGeneratePdfsCommand(bot: Bot<BotContext>, backend: BackendClient) {
  bot.command("generate_pdfs", async (ctx) => {
    await ctx.reply(ctx.t.flows.generatePdfs.requesting());

    try {
      await backend.POST("/flows/get-combined-pdf-lists", {
        params: {
          header: await getTelegramContextHeaders(ctx)
        }
      });
      await ctx.reply(ctx.t.flows.generatePdfs.finished());
    } catch (error) {
      await replyWithError(ctx, error);
    }
  });
}
