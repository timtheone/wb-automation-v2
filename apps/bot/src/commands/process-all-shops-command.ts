import { InputFile, type Bot } from "grammy";

import type { BackendClient } from "../backend-client.js";
import type { BotContext, ProcessAllShopsResultDto } from "../bot-types.js";
import type { BotTranslator } from "../i18n/index.js";
import { formatIsoDate, getTelegramContextHeaders, replyWithError, requireResponseData } from "./shared.js";

export function registerProcessAllShopsCommand(bot: Bot<BotContext>, backend: BackendClient) {
  bot.command("process_all_shops", async (ctx) => {
    await ctx.reply(ctx.t.flows.processAll.running());

    try {
      const response = await backend.POST("/flows/process-all-shops", {
        params: {
          header: await getTelegramContextHeaders(ctx)
        }
      });
      const result = requireResponseData(response.data, "POST /flows/process-all-shops");
      await ctx.reply(formatProcessAllShopsResult(ctx.t, result));
      await sendProcessAllShopsQrCodes(ctx, result);
    } catch (error) {
      await replyWithError(ctx, error);
    }
  });
}

async function sendProcessAllShopsQrCodes(ctx: BotContext, result: ProcessAllShopsResultDto): Promise<void> {
  for (const item of result.results) {
    if (item.status !== "success" || !item.barcodeFile) {
      continue;
    }

    const photoBuffer = Buffer.from(item.barcodeFile, "base64");

    if (photoBuffer.length === 0) {
      continue;
    }

    await ctx.replyWithPhoto(new InputFile(photoBuffer, `${item.shopId}-qr.png`), {
      caption: String(ctx.t.flows.processAll.qrCodeCaption({ shopName: item.shopName }))
    });
  }
}

function formatProcessAllShopsResult(t: BotTranslator, result: ProcessAllShopsResultDto): string {
  const lines: string[] = [
    String(t.flows.processAll.completed()),
    String(t.flows.processAll.processed({ count: result.processedShops })),
    String(t.flows.processAll.success({ count: result.successCount })),
    String(t.flows.processAll.skipped({ count: result.skippedCount })),
    String(t.flows.processAll.failed({ count: result.failureCount })),
    String(t.flows.processAll.started({ value: formatIsoDate(result.startedAt) })),
    String(t.flows.processAll.finished({ value: formatIsoDate(result.finishedAt) }))
  ];

  const preview = result.results.slice(0, 20);

  if (preview.length > 0) {
    lines.push(String(t.flows.processAll.details()));
  }

  for (const item of preview) {
    const status =
      item.status === "success"
        ? String(t.flows.status.success())
        : item.status === "skipped"
          ? String(t.flows.status.skipped())
          : String(t.flows.status.failed());
    const errorSuffix = item.error ? String(t.flows.processAll.errorSuffix({ error: item.error })) : "";
    const ordersInNewLabel = String(t.flows.processAll.ordersInNewLabel());
    const ordersAttachedLabel = String(t.flows.processAll.ordersAttachedLabel());
    lines.push(
      `- ${status} ${item.shopName} | ${ordersInNewLabel}=${item.ordersInNew} | ${ordersAttachedLabel}=${item.ordersAttached}${errorSuffix}`
    );
  }

  if (result.results.length > preview.length) {
    lines.push(String(t.flows.processAll.more({ count: result.results.length - preview.length })));
  }

  return lines.join("\n");
}
