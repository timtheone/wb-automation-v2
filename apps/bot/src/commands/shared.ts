import { BackendApiHttpError } from "../backend-client.js";
import type { BotContext } from "../bot-types.js";

const OWNER_CACHE_TTL_MS = 5 * 60 * 1000;

const ownerCache = new Map<number, { ownerTelegramUserId: number; expiresAtMs: number }>();

export interface TelegramContextHeaders {
  "x-telegram-chat-id": string;
  "x-telegram-chat-type": "private" | "group" | "supergroup" | "channel";
  "x-telegram-user-id": string;
  "x-telegram-owner-user-id": string;
}

export async function getTelegramContextHeaders(ctx: BotContext): Promise<TelegramContextHeaders> {
  return buildTelegramContextHeaders(ctx);
}

export async function replyWithError(ctx: BotContext, error: unknown) {
  const pending = ctx.session.pendingAction;

  if (error instanceof BackendApiHttpError) {
    await ctx.reply(`Request failed (${error.status}): ${error.message}`);
    return;
  }

  await ctx.reply(`Error: ${toErrorMessage(error)}`);

  if (pending && pending.kind === "create") {
    await ctx.reply("Create flow is still active. Use /cancel if needed.");
  }
}

export function requireResponseData<T>(payload: T | undefined, endpoint: string): T {
  if (payload === undefined) {
    throw new Error(`Backend returned empty response for ${endpoint}`);
  }

  return payload;
}

export function formatIsoDate(isoDate: string): string {
  const parsed = new Date(isoDate);

  if (Number.isNaN(parsed.getTime())) {
    return isoDate;
  }

  return parsed.toISOString();
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function buildTelegramContextHeaders(ctx: BotContext): Promise<TelegramContextHeaders> {
  const chat = ctx.chat;
  const from = ctx.from;

  if (!chat) {
    throw new Error("Telegram chat context is missing");
  }

  if (!from) {
    throw new Error("Telegram user context is missing");
  }

  const chatType = resolveSupportedChatType(chat.type);
  const ownerTelegramUserId =
    chatType === "private" ? from.id : await resolveGroupOwnerTelegramUserId(ctx, chat.id);

  return {
    "x-telegram-chat-id": String(chat.id),
    "x-telegram-chat-type": chatType,
    "x-telegram-user-id": String(from.id),
    "x-telegram-owner-user-id": String(ownerTelegramUserId)
  };
}

function resolveSupportedChatType(chatType: string): "private" | "group" | "supergroup" | "channel" {
  if (chatType === "private" || chatType === "group" || chatType === "supergroup" || chatType === "channel") {
    return chatType;
  }

  throw new Error(`Unsupported chat type for tenant scoping: ${chatType}`);
}

async function resolveGroupOwnerTelegramUserId(ctx: BotContext, chatId: number): Promise<number> {
  const nowMs = Date.now();
  const cached = ownerCache.get(chatId);

  if (cached && cached.expiresAtMs > nowMs) {
    return cached.ownerTelegramUserId;
  }

  const administrators = await ctx.api.getChatAdministrators(chatId);
  const owner = administrators.find((member) => member.status === "creator");

  if (!owner) {
    throw new Error("Unable to resolve chat owner for tenant scoping");
  }

  ownerCache.set(chatId, {
    ownerTelegramUserId: owner.user.id,
    expiresAtMs: nowMs + OWNER_CACHE_TTL_MS
  });

  return owner.user.id;
}
