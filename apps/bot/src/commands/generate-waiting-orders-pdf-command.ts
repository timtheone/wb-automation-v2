import type { Bot } from "grammy";

import type { BackendClient } from "../backend-client.js";
import type { BotContext } from "../bot-types.js";
import { getTelegramContextHeaders, replyWithError } from "./shared.js";

export function registerGenerateWaitingOrdersPdfCommand(bot: Bot<BotContext>, backend: BackendClient) {
  bot.command("generate_waiting_orders_pdf", async (ctx) => {
    await ctx.reply(ctx.t.flows.generateWaitingOrdersPdf.requesting());

    try {
      await backend.POST("/flows/get-waiting-orders-pdf", {
        params: {
          header: await getTelegramContextHeaders(ctx)
        }
      });
      await ctx.reply(ctx.t.flows.generateWaitingOrdersPdf.finished());
    } catch (error) {
      await replyWithError(ctx, error);
    }
  });
}
