import type { Bot } from "grammy";

import type { BackendClient } from "../backend-client.js";
import type { BotContext, SyncContentShopsResultDto } from "../bot-types.js";
import { formatIsoDate, getTelegramContextHeaders, replyWithError, requireResponseData } from "./shared.js";

export function registerSyncContentShopsCommand(bot: Bot<BotContext>, backend: BackendClient) {
  bot.command("sync_content_shops", async (ctx) => {
    await ctx.reply("Running sync_content_shops...");

    try {
      const response = await backend.POST("/flows/sync-content-shops", {
        params: {
          header: await getTelegramContextHeaders(ctx)
        }
      });
      const result = requireResponseData(response.data, "POST /flows/sync-content-shops");
      await ctx.reply(formatSyncContentShopsResult(result));
    } catch (error) {
      await replyWithError(ctx, error);
    }
  });
}

function formatSyncContentShopsResult(result: SyncContentShopsResultDto): string {
  const lines = [
    "sync_content_shops completed",
    `Processed: ${result.processedShops}`,
    `Success: ${result.successCount}`,
    `Failed: ${result.failureCount}`,
    `Total cards upserted: ${result.totalCardsUpserted}`,
    `Started: ${formatIsoDate(result.startedAt)}`,
    `Finished: ${formatIsoDate(result.finishedAt)}`
  ];

  const preview = result.results.slice(0, 20);

  if (preview.length > 0) {
    lines.push("Details:");
  }

  for (const item of preview) {
    const status = item.status.toUpperCase();
    const errorSuffix = item.error ? ` | error=${item.error}` : "";
    lines.push(
      `- ${status} ${item.shopName} | pages=${item.pagesFetched} | upserted=${item.cardsUpserted}${errorSuffix}`
    );
  }

  if (result.results.length > preview.length) {
    lines.push(`... and ${result.results.length - preview.length} more shops`);
  }

  return lines.join("\n");
}
