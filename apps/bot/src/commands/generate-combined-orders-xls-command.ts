import type { Bot } from "grammy";

import type { BackendClient } from "../backend-client.js";
import type { BotContext } from "../bot-types.js";
import { getTelegramContextHeaders, replyWithError, requireResponseData } from "./shared.js";

export function registerGenerateCombinedOrdersXlsCommand(bot: Bot<BotContext>, backend: BackendClient) {
  bot.command("generate_combined_orders_xls", async (ctx) => {
    try {
      await ctx.reply(ctx.t.flows.generateCombinedOrdersXls.requesting());

      const response = await backend.POST("/flows/get-combined-orders-xls", {
        params: {
          header: await getTelegramContextHeaders(ctx)
        }
      });

      const started = requireResponseData(response.data, "/flows/get-combined-orders-xls");

      if (started.status === "running") {
        await ctx.reply(ctx.t.flows.generateCombinedOrdersXls.alreadyRunning());
        return;
      }

      await ctx.reply(ctx.t.flows.generateCombinedOrdersXls.queued());
    } catch (error) {
      await replyWithError(ctx, error);
    }
  });
}
