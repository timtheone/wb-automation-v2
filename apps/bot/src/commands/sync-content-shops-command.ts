import type { Bot } from "grammy";

import type { BackendClient } from "../backend-client.js";
import type { BotContext } from "../bot-types.js";
import { getTelegramContextHeaders, replyWithError, requireResponseData } from "./shared.js";

export function registerSyncContentShopsCommand(bot: Bot<BotContext>, backend: BackendClient) {
  bot.command("sync_content_shops", async (ctx) => {
    await ctx.reply(ctx.t.flows.syncContent.running());

    try {
      const response = await backend.POST("/flows/sync-content-shops/async", {
        params: {
          header: await getTelegramContextHeaders(ctx)
        }
      });
      const started = requireResponseData(response.data, "POST /flows/sync-content-shops/async");

      if (started.status === "running") {
        await ctx.reply(ctx.t.flows.syncContent.alreadyRunning());
        return;
      }

      await ctx.reply(ctx.t.flows.syncContent.queued());
    } catch (error) {
      await replyWithError(ctx, error);
    }
  });
}
