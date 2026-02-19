import type { Bot } from "grammy";

import type { BackendClient } from "../backend-client.js";
import type { BotContext } from "../bot-types.js";
import { getTelegramContextHeaders, replyWithError, requireResponseData } from "./shared.js";

export function registerGeneratePdfsCommand(bot: Bot<BotContext>, backend: BackendClient) {
  bot.command("generate_pdfs", async (ctx) => {
    try {
      await ctx.reply(ctx.t.flows.generatePdfs.requesting());

      const response = await backend.POST("/flows/get-combined-pdf-lists", {
        params: {
          header: await getTelegramContextHeaders(ctx)
        }
      });

      const started = requireResponseData(response.data, "/flows/get-combined-pdf-lists");

      if (started.status === "running") {
        await ctx.reply(ctx.t.flows.generatePdfs.alreadyRunning());
        return;
      }

      await ctx.reply(ctx.t.flows.generatePdfs.queued());
    } catch (error) {
      await replyWithError(ctx, error);
    }
  });
}
