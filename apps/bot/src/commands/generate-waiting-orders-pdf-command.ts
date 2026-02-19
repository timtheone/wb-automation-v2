import type { Bot } from "grammy";

import type { BackendClient } from "../backend-client.js";
import type { BotContext } from "../bot-types.js";
import { getTelegramContextHeaders, replyWithError, requireResponseData } from "./shared.js";

export function registerGenerateWaitingOrdersPdfCommand(bot: Bot<BotContext>, backend: BackendClient) {
  bot.command("generate_waiting_orders_pdf", async (ctx) => {
    try {
      await ctx.reply(ctx.t.flows.generateWaitingOrdersPdf.requesting());

      const response = await backend.POST("/flows/get-waiting-orders-pdf", {
        params: {
          header: await getTelegramContextHeaders(ctx)
        }
      });

      const started = requireResponseData(response.data, "/flows/get-waiting-orders-pdf");

      if (started.status === "running") {
        await ctx.reply(ctx.t.flows.generateWaitingOrdersPdf.alreadyRunning());
        return;
      }

      await ctx.reply(ctx.t.flows.generateWaitingOrdersPdf.queued());
    } catch (error) {
      await replyWithError(ctx, error);
    }
  });
}
