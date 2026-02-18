import type { Bot } from "grammy";

import type { BackendClient } from "../backend-client.js";
import type { BotContext, ProcessAllShopsResultDto } from "../bot-types.js";
import { formatIsoDate, getTelegramContextHeaders, replyWithError, requireResponseData } from "./shared.js";

export function registerProcessAllShopsCommand(bot: Bot<BotContext>, backend: BackendClient) {
  bot.command("process_all_shops", async (ctx) => {
    await ctx.reply("Running process_all_shops...");

    try {
      const response = await backend.POST("/flows/process-all-shops", {
        params: {
          header: await getTelegramContextHeaders(ctx)
        }
      });
      const result = requireResponseData(response.data, "POST /flows/process-all-shops");
      await ctx.reply(formatProcessAllShopsResult(result));
    } catch (error) {
      await replyWithError(ctx, error);
    }
  });
}

function formatProcessAllShopsResult(result: ProcessAllShopsResultDto): string {
  const lines = [
    "process_all_shops completed",
    `Processed: ${result.processedShops}`,
    `Success: ${result.successCount}`,
    `Skipped: ${result.skippedCount}`,
    `Failed: ${result.failureCount}`,
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
      `- ${status} ${item.shopName} | in_new=${item.ordersInNew} | attached=${item.ordersAttached}${errorSuffix}`
    );
  }

  if (result.results.length > preview.length) {
    lines.push(`... and ${result.results.length - preview.length} more shops`);
  }

  return lines.join("\n");
}
