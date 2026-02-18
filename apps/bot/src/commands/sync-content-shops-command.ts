import type { Bot } from "grammy";

import type { BackendClient } from "../backend-client.js";
import type { BotContext, SyncContentShopsResultDto } from "../bot-types.js";
import type { BotTranslator } from "../i18n/index.js";
import { formatIsoDate, getTelegramContextHeaders, replyWithError, requireResponseData } from "./shared.js";

export function registerSyncContentShopsCommand(bot: Bot<BotContext>, backend: BackendClient) {
  bot.command("sync_content_shops", async (ctx) => {
    await ctx.reply(ctx.t.flows.syncContent.running());

    try {
      const response = await backend.POST("/flows/sync-content-shops", {
        params: {
          header: await getTelegramContextHeaders(ctx)
        }
      });
      const result = requireResponseData(response.data, "POST /flows/sync-content-shops");
      await ctx.reply(formatSyncContentShopsResult(ctx.t, result));
    } catch (error) {
      await replyWithError(ctx, error);
    }
  });
}

function formatSyncContentShopsResult(t: BotTranslator, result: SyncContentShopsResultDto): string {
  const lines: string[] = [
    String(t.flows.syncContent.completed()),
    String(t.flows.syncContent.processed({ count: result.processedShops })),
    String(t.flows.syncContent.success({ count: result.successCount })),
    String(t.flows.syncContent.failed({ count: result.failureCount })),
    String(t.flows.syncContent.totalCardsUpserted({ count: result.totalCardsUpserted })),
    String(t.flows.syncContent.started({ value: formatIsoDate(result.startedAt) })),
    String(t.flows.syncContent.finished({ value: formatIsoDate(result.finishedAt) }))
  ];

  const preview = result.results.slice(0, 20);

  if (preview.length > 0) {
    lines.push(String(t.flows.syncContent.details()));
  }

  for (const item of preview) {
    const status =
      item.status === "success" ? String(t.flows.status.success()) : String(t.flows.status.failed());
    const errorSuffix = item.error ? String(t.flows.syncContent.errorSuffix({ error: item.error })) : "";
    const pagesFetchedLabel = String(t.flows.syncContent.pagesFetchedLabel());
    const cardsUpsertedLabel = String(t.flows.syncContent.cardsUpsertedLabel());
    lines.push(
      `- ${status} ${item.shopName} | ${pagesFetchedLabel}=${item.pagesFetched} | ${cardsUpsertedLabel}=${item.cardsUpserted}${errorSuffix}`
    );
  }

  if (result.results.length > preview.length) {
    lines.push(String(t.flows.syncContent.more({ count: result.results.length - preview.length })));
  }

  return lines.join("\n");
}
