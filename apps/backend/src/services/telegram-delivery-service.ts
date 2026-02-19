import type { GetCombinedPdfListsResult } from "@wb-automation-v2/core";

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
    }
  };
}

type DeliveryLocale = "en" | "ru";

type DeliveryTemplateKey = "generationCompleted" | "done" | "failed";

const DELIVERY_TEXTS: Record<DeliveryLocale, Record<DeliveryTemplateKey, string>> = {
  en: {
    generationCompleted: "PDF generation completed. Sending files...",
    done: "Done. Orders collected: {totalOrdersCollected}. Shops processed: {processedShops}.",
    failed: "PDF generation failed: {errorMessage}"
  },
  ru: {
    generationCompleted: "Генерация PDF завершена. Отправляю файлы...",
    done: "Готово. Собрано заказов: {totalOrdersCollected}. Обработано магазинов: {processedShops}.",
    failed: "Генерация PDF завершилась ошибкой: {errorMessage}"
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
