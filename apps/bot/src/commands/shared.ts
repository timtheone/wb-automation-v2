import { BackendApiHttpError } from "../backend-client.js";
import type { BotContext } from "../bot-types.js";
import type { BotTranslator } from "../i18n/index.js";

const OWNER_CACHE_TTL_MS = 5 * 60 * 1000;

const ownerCache = new Map<number, { ownerTelegramUserId: number; expiresAtMs: number }>();

type BotCommandErrorCode =
  | "BACKEND_EMPTY_RESPONSE"
  | "TELEGRAM_CHAT_CONTEXT_MISSING"
  | "TELEGRAM_USER_CONTEXT_MISSING"
  | "TELEGRAM_CHAT_TYPE_UNSUPPORTED"
  | "TELEGRAM_CHAT_OWNER_UNRESOLVED"
  | "SHOP_NOT_FOUND"
  | "INVALID_CALLBACK_PAYLOAD"
  | "FIELD_MUST_NOT_BE_EMPTY"
  | "CREATE_FLOW_REQUIRED_FIELDS_MISSING";

type BotCommandErrorParams = Record<string, string | number>;

export class BotCommandError extends Error {
  readonly code: BotCommandErrorCode;
  readonly params: BotCommandErrorParams;

  constructor(code: BotCommandErrorCode, params: BotCommandErrorParams = {}) {
    super(code);
    this.name = "BotCommandError";
    this.code = code;
    this.params = params;
  }
}

export function createBotCommandError(
  code: BotCommandErrorCode,
  params: BotCommandErrorParams = {}
): BotCommandError {
  return new BotCommandError(code, params);
}

export interface TelegramContextHeaders {
  "x-telegram-chat-id": string;
  "x-telegram-chat-type": "private" | "group" | "supergroup" | "channel";
  "x-telegram-user-id": string;
  "x-telegram-owner-user-id": string;
  "x-telegram-language-code"?: string;
}

export async function getTelegramContextHeaders(ctx: BotContext): Promise<TelegramContextHeaders> {
  return buildTelegramContextHeaders(ctx);
}

export async function replyWithError(ctx: BotContext, error: unknown) {
  const pending = ctx.session.pendingAction;

  if (error instanceof BackendApiHttpError) {
    await ctx.reply(
      ctx.t.errors.requestFailed({
        status: error.status,
        message: resolveBackendApiErrorMessage(ctx.t, error)
      })
    );
    return;
  }

  if (error instanceof BotCommandError) {
    await ctx.reply(resolveBotCommandErrorMessage(ctx.t, error));
    return;
  }

  await ctx.reply(ctx.t.errors.unexpected({ message: toErrorMessage(error) }));

  if (pending && pending.kind === "create") {
    await ctx.reply(ctx.t.errors.createFlowStillActive());
  }
}

export function requireResponseData<T>(payload: T | undefined, endpoint: string): T {
  if (payload === undefined) {
    throw createBotCommandError("BACKEND_EMPTY_RESPONSE", { endpoint });
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
    throw createBotCommandError("TELEGRAM_CHAT_CONTEXT_MISSING");
  }

  if (!from) {
    throw createBotCommandError("TELEGRAM_USER_CONTEXT_MISSING");
  }

  const chatType = resolveSupportedChatType(chat.type);
  const ownerTelegramUserId =
    chatType === "private" ? from.id : await resolveGroupOwnerTelegramUserId(ctx, chat.id);

  const headers: TelegramContextHeaders = {
    "x-telegram-chat-id": String(chat.id),
    "x-telegram-chat-type": chatType,
    "x-telegram-user-id": String(from.id),
    "x-telegram-owner-user-id": String(ownerTelegramUserId)
  };

  if (typeof from.language_code === "string" && from.language_code.trim().length > 0) {
    headers["x-telegram-language-code"] = from.language_code;
  }

  return headers;
}

function resolveSupportedChatType(
  chatType: string
): "private" | "group" | "supergroup" | "channel" {
  if (
    chatType === "private" ||
    chatType === "group" ||
    chatType === "supergroup" ||
    chatType === "channel"
  ) {
    return chatType;
  }

  throw createBotCommandError("TELEGRAM_CHAT_TYPE_UNSUPPORTED", { chatType });
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
    throw createBotCommandError("TELEGRAM_CHAT_OWNER_UNRESOLVED");
  }

  ownerCache.set(chatId, {
    ownerTelegramUserId: owner.user.id,
    expiresAtMs: nowMs + OWNER_CACHE_TTL_MS
  });

  return owner.user.id;
}

function resolveBackendApiErrorMessage(t: BotTranslator, error: BackendApiHttpError): string {
  const payload = readBackendErrorPayload(error.details);
  const translatedByCode = payload.code ? resolveBackendErrorCodeMessage(t, payload.code) : null;

  if (translatedByCode) {
    return translatedByCode;
  }

  if (payload.message) {
    return payload.message;
  }

  return error.message;
}

function resolveBackendErrorCodeMessage(t: BotTranslator, code: string): string | null {
  switch (code) {
    case "FLOW_GET_COMBINED_PDF_LISTS_NOT_IMPLEMENTED":
      return t.errors.flowGetCombinedPdfListsNotImplemented();
    case "FLOW_GET_WAITING_ORDERS_PDF_NOT_IMPLEMENTED":
      return t.errors.flowGetWaitingOrdersPdfNotImplemented();
    case "FLOW_JOB_NOT_FOUND":
      return t.errors.flowJobNotFound();
    case "REQUEST_BODY_INVALID_JSON":
      return t.errors.requestBodyInvalidJson();
    case "REQUEST_BODY_INVALID":
      return t.errors.invalidRequestBody();
    case "TELEGRAM_CONTEXT_INVALID":
      return t.errors.invalidTelegramContextHeaders();
    case "TELEGRAM_PRIVATE_OWNER_MISMATCH":
      return t.errors.privateOwnerMismatch();
    case "SHOP_NOT_FOUND":
      return t.errors.shopNotFoundGeneric();
    case "SHOP_NAME_ALREADY_EXISTS":
      return t.errors.shopNameAlreadyExists();
    case "INTERNAL_SERVER_ERROR":
      return t.errors.internalServerError();
    default:
      return null;
  }
}

function readBackendErrorPayload(details: unknown): { code?: string; message?: string } {
  if (typeof details !== "object" || details === null) {
    return {};
  }

  const maybePayload = details as {
    code?: unknown;
    error?: unknown;
  };

  return {
    code: typeof maybePayload.code === "string" ? maybePayload.code : undefined,
    message: typeof maybePayload.error === "string" ? maybePayload.error : undefined
  };
}

function resolveBotCommandErrorMessage(t: BotTranslator, error: BotCommandError): string {
  switch (error.code) {
    case "BACKEND_EMPTY_RESPONSE":
      return t.errors.backendEmptyResponse({ endpoint: readErrorParam(error.params, "endpoint") });
    case "TELEGRAM_CHAT_CONTEXT_MISSING":
      return t.errors.telegramChatContextMissing();
    case "TELEGRAM_USER_CONTEXT_MISSING":
      return t.errors.telegramUserContextMissing();
    case "TELEGRAM_CHAT_TYPE_UNSUPPORTED":
      return t.errors.unsupportedChatType({ chatType: readErrorParam(error.params, "chatType") });
    case "TELEGRAM_CHAT_OWNER_UNRESOLVED":
      return t.errors.unableToResolveChatOwner();
    case "SHOP_NOT_FOUND":
      return t.errors.shopNotFound({ shopId: readErrorParam(error.params, "shopId") });
    case "INVALID_CALLBACK_PAYLOAD":
      return t.errors.invalidCallbackPayload();
    case "FIELD_MUST_NOT_BE_EMPTY":
      return t.errors.fieldMustNotBeEmpty({ field: readErrorParam(error.params, "field") });
    case "CREATE_FLOW_REQUIRED_FIELDS_MISSING":
      return t.shops.createFlowLostRequiredFields();
    default:
      return t.errors.unexpected({ message: error.message });
  }
}

function readErrorParam(params: BotCommandErrorParams, key: string): string {
  const value = params[key];

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return "";
}
