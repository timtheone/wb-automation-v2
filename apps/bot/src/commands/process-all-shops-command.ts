import { InputFile, type Bot } from "grammy";

import type { BackendClient } from "../backend-client.js";
import type { BotContext, ProcessAllShopsResultDto } from "../bot-types.js";
import type { BotTranslator } from "../i18n/index.js";
import { logger } from "../logger.js";
import { formatIsoDate, getTelegramContextHeaders, replyWithError, requireResponseData } from "./shared.js";

export function registerProcessAllShopsCommand(bot: Bot<BotContext>, backend: BackendClient) {
  bot.command("process_all_shops", async (ctx) => {
    await ctx.reply(ctx.t.flows.processAll.running());

    const logContext = {
      updateId: ctx.update.update_id,
      chatId: ctx.chat?.id,
      userId: ctx.from?.id
    };

    try {
      const response = await backend.POST("/flows/process-all-shops", {
        params: {
          header: await getTelegramContextHeaders(ctx)
        }
      });
      const result = requireResponseData(response.data, "POST /flows/process-all-shops");
      logger.info(
        {
          ...logContext,
          processedShops: result.processedShops,
          successCount: result.successCount,
          skippedCount: result.skippedCount,
          failureCount: result.failureCount,
          shops: result.results.map((item) => ({
            shopId: item.shopId,
            shopName: item.shopName,
            status: item.status,
            ordersInNew: item.ordersInNew,
            ordersAttached: item.ordersAttached,
            hasBarcodeFile: Boolean(item.barcodeFile),
            error: item.error
          }))
        },
        "process_all_shops completed"
      );
      await ctx.reply(formatProcessAllShopsResult(ctx.t, result));
      await sendProcessAllShopsQrCodes(ctx, result, logContext);
    } catch (error) {
      await replyWithError(ctx, error);
    }
  });
}

async function sendProcessAllShopsQrCodes(
  ctx: BotContext,
  result: ProcessAllShopsResultDto,
  logContext: { updateId: number; chatId: number | undefined; userId: number | undefined }
): Promise<void> {
  let sentCount = 0;

  for (const item of result.results) {
    if (item.status !== "success" || !item.barcodeFile) {
      logger.info(
        {
          ...logContext,
          shopId: item.shopId,
          shopName: item.shopName,
          status: item.status,
          hasBarcodeFile: Boolean(item.barcodeFile)
        },
        "process_all_shops qr skipped"
      );
      continue;
    }

    const photoBuffer = Buffer.from(item.barcodeFile, "base64");

    if (photoBuffer.length === 0) {
      logger.warn(
        {
          ...logContext,
          shopId: item.shopId,
          shopName: item.shopName
        },
        "process_all_shops qr has empty decoded payload"
      );
      continue;
    }

    await ctx.reply(String(ctx.t.flows.processAll.qrCodeCaption({ shopName: item.shopName })));
    await ctx.replyWithPhoto(new InputFile(photoBuffer, `${item.shopId}-qr.png`));
    sentCount += 1;

    logger.info(
      {
        ...logContext,
        shopId: item.shopId,
        shopName: item.shopName,
        payloadBytes: photoBuffer.length
      },
      "process_all_shops qr sent"
    );
  }

  logger.info({ ...logContext, qrSentCount: sentCount }, "process_all_shops qr delivery completed");
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
