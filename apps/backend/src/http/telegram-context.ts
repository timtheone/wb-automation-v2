import type { Context } from "hono";
import { z } from "zod";

import { RequestValidationError } from "./validation.js";

const safeIntegerSchema = z
  .number()
  .int()
  .refine((value) => Number.isSafeInteger(value), "must be a safe integer");

const telegramContextSchema = z.object({
  chatId: z.coerce.number().pipe(safeIntegerSchema),
  chatType: z.enum(["private", "group", "supergroup", "channel"]),
  requesterTelegramUserId: z.coerce.number().pipe(safeIntegerSchema),
  ownerTelegramUserId: z.coerce.number().pipe(safeIntegerSchema),
  languageCode: z
    .string()
    .trim()
    .min(1)
    .max(35)
    .optional()
});

export const TELEGRAM_CHAT_ID_HEADER = "x-telegram-chat-id";
export const TELEGRAM_CHAT_TYPE_HEADER = "x-telegram-chat-type";
export const TELEGRAM_USER_ID_HEADER = "x-telegram-user-id";
export const TELEGRAM_OWNER_USER_ID_HEADER = "x-telegram-owner-user-id";
export const TELEGRAM_LANGUAGE_CODE_HEADER = "x-telegram-language-code";

export type TelegramRequestContext = z.infer<typeof telegramContextSchema>;

export function readTelegramRequestContext(c: Context): TelegramRequestContext {
  const parsed = telegramContextSchema.safeParse({
    chatId: c.req.header(TELEGRAM_CHAT_ID_HEADER),
    chatType: c.req.header(TELEGRAM_CHAT_TYPE_HEADER),
    requesterTelegramUserId: c.req.header(TELEGRAM_USER_ID_HEADER),
    ownerTelegramUserId: c.req.header(TELEGRAM_OWNER_USER_ID_HEADER),
    languageCode: c.req.header(TELEGRAM_LANGUAGE_CODE_HEADER)
  });

  if (!parsed.success) {
    throw new RequestValidationError(
      "Invalid Telegram context headers",
      z.flattenError(parsed.error),
      "TELEGRAM_CONTEXT_INVALID"
    );
  }

  if (parsed.data.chatType === "private" && parsed.data.ownerTelegramUserId !== parsed.data.requesterTelegramUserId) {
    throw new RequestValidationError(
      "owner telegram user must match requester in private chats",
      null,
      "TELEGRAM_PRIVATE_OWNER_MISMATCH"
    );
  }

  return parsed.data;
}
