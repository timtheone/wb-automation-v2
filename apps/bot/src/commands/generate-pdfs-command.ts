import type { Bot } from "grammy";

import type { BackendClient } from "../backend-client.js";
import type { BotContext } from "../bot-types.js";
import { replyWithError } from "./shared.js";

export function registerGeneratePdfsCommand(bot: Bot<BotContext>, backend: BackendClient) {
  bot.command("generate_pdfs", async (ctx) => {
    await ctx.reply("Requesting get_combined_pdf_lists...");

    try {
      await backend.POST("/flows/get-combined-pdf-lists");
      await ctx.reply("get_combined_pdf_lists finished.");
    } catch (error) {
      await replyWithError(ctx, error);
    }
  });
}
