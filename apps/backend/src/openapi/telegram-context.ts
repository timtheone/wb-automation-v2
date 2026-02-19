import { z } from "@hono/zod-openapi";

import {
  TELEGRAM_CHAT_ID_HEADER,
  TELEGRAM_CHAT_TYPE_HEADER,
  TELEGRAM_LANGUAGE_CODE_HEADER,
  TELEGRAM_OWNER_USER_ID_HEADER,
  TELEGRAM_USER_ID_HEADER
} from "../http/telegram-context.js";

export const telegramContextHeadersSchema = z
  .object({
    [TELEGRAM_CHAT_ID_HEADER]: z.string().regex(/^-?\d+$/),
    [TELEGRAM_CHAT_TYPE_HEADER]: z.enum(["private", "group", "supergroup", "channel"]),
    [TELEGRAM_USER_ID_HEADER]: z.string().regex(/^-?\d+$/),
    [TELEGRAM_OWNER_USER_ID_HEADER]: z.string().regex(/^-?\d+$/),
    [TELEGRAM_LANGUAGE_CODE_HEADER]: z.string().min(1).optional()
  })
  .openapi("TelegramContextHeaders");
