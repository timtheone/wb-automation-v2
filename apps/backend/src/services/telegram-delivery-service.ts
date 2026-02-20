import type { GetCombinedPdfListsResult } from "@wb-automation-v2/core";
import type { SyncContentShopsResult } from "@wb-automation-v2/core";
import type { WbTokenExpirationWarning } from "@wb-automation-v2/core";

import { readRuntimeEnv } from "../config/env.js";
import { createLogger } from "../logger.js";

const TELEGRAM_API_BASE_URL = "https://api.telegram.org";

export interface TelegramDeliveryService {
  sendCombinedPdfGenerated(
    chatId: number,
    result: GetCombinedPdfListsResult,
    languageCode: string | null
  ): Promise<void>;
  sendCombinedPdfFailed(chatId: number, errorMessage: string, languageCode: string | null): Promise<void>;
  sendWaitingOrdersPdfGenerated(
    chatId: number,
    result: GetCombinedPdfListsResult,
    languageCode: string | null
  ): Promise<void>;
  sendWaitingOrdersPdfFailed(chatId: number, errorMessage: string, languageCode: string | null): Promise<void>;
  sendSyncContentShopsCompleted(
    chatId: number,
    result: SyncContentShopsResult,
    languageCode: string | null
  ): Promise<void>;
  sendSyncContentShopsFailed(chatId: number, errorMessage: string, languageCode: string | null): Promise<void>;
  sendSyncContentShopsFailureSummary(
    chatId: number,
    summary: {
      processedShops: number;
      successCount: number;
      failureCount: number;
      totalCardsUpserted: number;
      failedShops: Array<{
        shopId: string;
        shopName: string;
        error: string;
      }>;
    },
    languageCode: string | null
  ): Promise<void>;
  sendWbTokenExpirationWarnings(
    chatId: number,
    warnings: WbTokenExpirationWarning[],
    languageCode?: string | null
  ): Promise<void>;
}

export function createTelegramDeliveryService(): TelegramDeliveryService {
  const logger = createLogger({ component: "telegram-delivery" });
  const token = readRuntimeEnv("BOT_TOKEN");

  if (!token) {
    return {
      async sendCombinedPdfGenerated() {
        throw new Error("BOT_TOKEN is configured in backend environment");
      },
      async sendCombinedPdfFailed() {
        throw new Error("BOT_TOKEN is configured in backend environment");
      },
      async sendWaitingOrdersPdfGenerated() {
        throw new Error("BOT_TOKEN is configured in backend environment");
      },
      async sendWaitingOrdersPdfFailed() {
        throw new Error("BOT_TOKEN is configured in backend environment");
      },
      async sendSyncContentShopsCompleted() {
        throw new Error("BOT_TOKEN is configured in backend environment");
      },
      async sendSyncContentShopsFailed() {
        throw new Error("BOT_TOKEN is configured in backend environment");
      },
      async sendSyncContentShopsFailureSummary() {
        throw new Error("BOT_TOKEN is configured in backend environment");
      },
      async sendWbTokenExpirationWarnings() {
        throw new Error("BOT_TOKEN is configured in backend environment");
      }
    };
  }

  const baseUrl = `${TELEGRAM_API_BASE_URL}/bot${token}`;

  return {
    async sendCombinedPdfGenerated(chatId, result, languageCode) {
      const locale = resolveLocale(languageCode);

      await sendMessage(baseUrl, chatId, t(locale, "generationCompleted"));

      await sendDocument(baseUrl, chatId, result.orderListFileName, result.orderListPdfBase64);
      await sendDocument(baseUrl, chatId, result.stickersFileName, result.stickersPdfBase64);

      await sendMessage(
        baseUrl,
        chatId,
        t(locale, "done", {
          totalOrdersCollected: result.totalOrdersCollected,
          processedShops: result.processedShops
        })
      );

      logger.info(
        {
          chatId,
          totalOrdersCollected: result.totalOrdersCollected,
          processedShops: result.processedShops
        },
        "sent combined-pdf artifacts to telegram"
      );
    },
    async sendCombinedPdfFailed(chatId, errorMessage, languageCode) {
      const locale = resolveLocale(languageCode);
      await sendMessage(baseUrl, chatId, t(locale, "failed", { errorMessage }));
    },
    async sendWaitingOrdersPdfGenerated(chatId, result, languageCode) {
      const locale = resolveLocale(languageCode);

      await sendMessage(baseUrl, chatId, t(locale, "waitingGenerationCompleted"));

      await sendDocument(baseUrl, chatId, result.orderListFileName, result.orderListPdfBase64);
      await sendDocument(baseUrl, chatId, result.stickersFileName, result.stickersPdfBase64);

      await sendMessage(
        baseUrl,
        chatId,
        t(locale, "waitingDone", {
          totalOrdersCollected: result.totalOrdersCollected,
          processedShops: result.processedShops
        })
      );

      logger.info(
        {
          chatId,
          totalOrdersCollected: result.totalOrdersCollected,
          processedShops: result.processedShops
        },
        "sent waiting-orders-pdf artifacts to telegram"
      );
    },
    async sendWaitingOrdersPdfFailed(chatId, errorMessage, languageCode) {
      const locale = resolveLocale(languageCode);
      await sendMessage(baseUrl, chatId, t(locale, "waitingFailed", { errorMessage }));
    },
    async sendSyncContentShopsCompleted(chatId, result, languageCode) {
      const locale = resolveLocale(languageCode);

      await sendMessage(
        baseUrl,
        chatId,
        t(locale, "syncDone", {
          processedShops: result.processedShops,
          successCount: result.successCount,
          failureCount: result.failureCount,
          totalCardsUpserted: result.totalCardsUpserted
        })
      );

      logger.info(
        {
          chatId,
          processedShops: result.processedShops,
          successCount: result.successCount,
          failureCount: result.failureCount,
          totalCardsUpserted: result.totalCardsUpserted
        },
        "sent sync-content-shops completion to telegram"
      );
    },
    async sendSyncContentShopsFailed(chatId, errorMessage, languageCode) {
      const locale = resolveLocale(languageCode);
      await sendMessage(baseUrl, chatId, t(locale, "syncFailed", { errorMessage }));
    },
    async sendSyncContentShopsFailureSummary(chatId, summary, languageCode) {
      const locale = await resolveLocaleForChat(baseUrl, chatId, languageCode);
      const lines = [
        t(locale, "syncFailuresSummaryHeader", {
          processedShops: summary.processedShops,
          successCount: summary.successCount,
          failureCount: summary.failureCount,
          totalCardsUpserted: summary.totalCardsUpserted
        }),
        ...summary.failedShops.map((failedShop, index) =>
          t(locale, "syncFailuresSummaryItem", {
            index: index + 1,
            shopName: failedShop.shopName,
            shopId: failedShop.shopId,
            errorMessage: failedShop.error
          })
        )
      ];

      await sendMessage(baseUrl, chatId, lines.join("\n"));
    },
    async sendWbTokenExpirationWarnings(chatId, warnings, languageCode = null) {
      if (warnings.length === 0) {
        return;
      }

      const locale = await resolveLocaleForChat(baseUrl, chatId, languageCode);
      const lines = [
        t(locale, "tokenExpirationHeader"),
        ...warnings.map(
          (warning, index) =>
            t(locale, "tokenExpirationItem", {
              index: index + 1,
              shopName: warning.shopName,
              daysLeft: warning.daysLeft,
              expiresAt: warning.expiresAt.toISOString()
            })
        )
      ];

      await sendMessage(baseUrl, chatId, lines.join("\n"));
    }
  };
}

type DeliveryLocale = "en" | "ru";

type DeliveryTemplateKey =
  | "generationCompleted"
  | "done"
  | "failed"
  | "waitingGenerationCompleted"
  | "waitingDone"
  | "waitingFailed"
  | "syncDone"
  | "syncFailed"
  | "syncFailuresSummaryHeader"
  | "syncFailuresSummaryItem"
  | "tokenExpirationHeader"
  | "tokenExpirationItem";

const DELIVERY_TEXTS: Record<DeliveryLocale, Record<DeliveryTemplateKey, string>> = {
  en: {
    generationCompleted: "PDF generation completed. Sending files...",
    done: "Done. Orders collected: {totalOrdersCollected}. Shops processed: {processedShops}.",
    failed: "PDF generation failed: {errorMessage}",
    waitingGenerationCompleted: "Waiting-orders PDF generation completed. Sending files...",
    waitingDone: "Done. Waiting orders collected: {totalOrdersCollected}. Shops processed: {processedShops}.",
    waitingFailed: "Waiting-orders PDF generation failed: {errorMessage}",
    syncDone:
      "sync_content_shops completed. Processed: {processedShops}. Success: {successCount}. Failed: {failureCount}. New cards added: {totalCardsUpserted}.",
    syncFailed: "sync_content_shops failed: {errorMessage}",
    syncFailuresSummaryHeader:
      "sync_content_shops completed with failures. Processed: {processedShops}. Success: {successCount}. Failed: {failureCount}. New cards added: {totalCardsUpserted}. Failed shops:",
    syncFailuresSummaryItem: "{index}. {shopName} ({shopId}) - {errorMessage}",
    tokenExpirationHeader: "⚠️ WB token expiration warning:",
    tokenExpirationItem: "{index}. {shopName} - expires in {daysLeft} day(s) ({expiresAt})"
  },
  ru: {
    generationCompleted: "Генерация PDF завершена. Отправляю файлы...",
    done: "Готово. Собрано заказов: {totalOrdersCollected}. Обработано магазинов: {processedShops}.",
    failed: "Генерация PDF завершилась ошибкой: {errorMessage}",
    waitingGenerationCompleted: "Генерация PDF для ожидающих заказов завершена. Отправляю файлы...",
    waitingDone:
      "Готово. Собрано ожидающих заказов: {totalOrdersCollected}. Обработано магазинов: {processedShops}.",
    waitingFailed: "Генерация PDF для ожидающих заказов завершилась ошибкой: {errorMessage}",
    syncDone:
      "sync_content_shops завершен. Обработано: {processedShops}. Успешно: {successCount}. С ошибкой: {failureCount}. Новых карточек добавлено: {totalCardsUpserted}.",
    syncFailed: "sync_content_shops завершился ошибкой: {errorMessage}",
    syncFailuresSummaryHeader:
      "sync_content_shops завершен с ошибками. Обработано: {processedShops}. Успешно: {successCount}. С ошибкой: {failureCount}. Новых карточек добавлено: {totalCardsUpserted}. Магазины с ошибками:",
    syncFailuresSummaryItem: "{index}. {shopName} ({shopId}) - {errorMessage}",
    tokenExpirationHeader: "⚠️ Срок действия WB токена скоро истечет:",
    tokenExpirationItem: "{index}. {shopName} - истекает через {daysLeft} дн. ({expiresAt})"
  }
};

function resolveLocale(languageCode: string | null): DeliveryLocale {
  if (languageCode && languageCode.toLowerCase().startsWith("ru")) {
    return "ru";
  }

  return "en";
}

function t(locale: DeliveryLocale, key: DeliveryTemplateKey, params: Record<string, number | string> = {}): string {
  const template = DELIVERY_TEXTS[locale][key];

  return template.replace(/\{([a-zA-Z0-9_]+)\}/gu, (_, name: string) => {
    const value = params[name];
    return value === undefined ? "" : String(value);
  });
}

async function sendMessage(baseUrl: string, chatId: number, text: string): Promise<void> {
  const response = await fetch(`${baseUrl}/sendMessage`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      chat_id: String(chatId),
      text
    })
  });

  await assertTelegramResponse(response, "sendMessage");
}

async function sendDocument(
  baseUrl: string,
  chatId: number,
  fileName: string,
  base64Pdf: string
): Promise<void> {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append(
    "document",
    new Blob([Buffer.from(base64Pdf, "base64")], { type: "application/pdf" }),
    fileName
  );

  const response = await fetch(`${baseUrl}/sendDocument`, {
    method: "POST",
    body: form
  });

  await assertTelegramResponse(response, "sendDocument");
}

async function assertTelegramResponse(response: Response, operation: string): Promise<void> {
  if (response.ok) {
    return;
  }

  throw new Error(`Telegram API ${operation} failed with status ${response.status}: ${await response.text()}`);
}

async function resolveLocaleForChat(
  baseUrl: string,
  chatId: number,
  explicitLanguageCode: string | null
): Promise<DeliveryLocale> {
  if (explicitLanguageCode && explicitLanguageCode.trim().length > 0) {
    return resolveLocale(explicitLanguageCode);
  }

  const inferredLanguageCode = await tryFetchChatLanguageCode(baseUrl, chatId);
  return resolveLocale(inferredLanguageCode);
}

async function tryFetchChatLanguageCode(baseUrl: string, chatId: number): Promise<string | null> {
  try {
    const response = await fetch(`${baseUrl}/getChatMember`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        chat_id: String(chatId),
        user_id: String(chatId)
      })
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      ok?: unknown;
      result?: {
        user?: {
          language_code?: unknown;
        };
      };
    };

    if (payload.ok !== true) {
      return null;
    }

    const languageCode = payload.result?.user?.language_code;
    return typeof languageCode === "string" && languageCode.length > 0 ? languageCode : null;
  } catch {
    return null;
  }
}
