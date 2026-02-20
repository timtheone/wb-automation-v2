import { describe, expect, it, vi } from "vitest";

import { BackendApiHttpError } from "../backend-client.js";
import type { BotContext } from "../bot-types.js";
import { createTranslator } from "../i18n/index.js";
import {
  createBotCommandError,
  getTelegramContextHeaders,
  replyWithError,
  requireResponseData
} from "./shared.js";

function createContext(overrides: Partial<BotContext> = {}) {
  const reply = vi.fn<(text: string) => Promise<void>>(async () => undefined);
  const getChatAdministrators = vi.fn(async () => [
    {
      status: "administrator",
      user: { id: 111 }
    },
    {
      status: "creator",
      user: { id: 999 }
    }
  ]);

  const ctx = {
    update: { update_id: 1 },
    chat: { id: 123, type: "private" },
    from: { id: 222, language_code: "en" },
    session: { pendingAction: null },
    t: createTranslator("en"),
    api: {
      getChatAdministrators
    },
    reply,
    ...overrides
  } as unknown as BotContext;

  return { ctx, reply, getChatAdministrators };
}

describe("bot command shared helpers", () => {
  it("builds Telegram headers for private chats", async () => {
    const { ctx } = createContext({
      chat: { id: 555, type: "private" } as never,
      from: { id: 777, language_code: "ru" } as never
    });

    const headers = await getTelegramContextHeaders(ctx);

    expect(headers).toEqual({
      "x-telegram-chat-id": "555",
      "x-telegram-chat-type": "private",
      "x-telegram-user-id": "777",
      "x-telegram-owner-user-id": "777",
      "x-telegram-language-code": "ru"
    });
  });

  it("resolves and caches group owner when building Telegram headers", async () => {
    const { ctx, getChatAdministrators } = createContext({
      chat: { id: 1000, type: "group" } as never,
      from: { id: 333, language_code: "en" } as never
    });

    const first = await getTelegramContextHeaders(ctx);
    const second = await getTelegramContextHeaders(ctx);

    expect(first["x-telegram-owner-user-id"]).toBe("999");
    expect(second["x-telegram-owner-user-id"]).toBe("999");
    expect(getChatAdministrators).toHaveBeenCalledTimes(1);
  });

  it("formats backend HTTP errors into translated user-facing messages", async () => {
    const { ctx, reply } = createContext();
    const error = new BackendApiHttpError(
      {
        status: 404,
        statusText: "Not Found",
        url: "https://backend.test/shops/1",
        headers: {
          get() {
            return "application/json";
          }
        },
        clone() {
          return this;
        },
        async json() {
          return {
            code: "SHOP_NOT_FOUND",
            error: "Shop not found: 1"
          };
        },
        async text() {
          return "";
        }
      },
      {
        code: "SHOP_NOT_FOUND",
        error: "Shop not found: 1"
      }
    );

    await replyWithError(ctx, error);

    expect(reply).toHaveBeenCalledWith("Request failed (404): Shop not found");
  });

  it("throws typed error when backend payload is missing", () => {
    expect(() => requireResponseData(undefined, "POST /flows/process-all-shops")).toThrowError(
      "BACKEND_EMPTY_RESPONSE"
    );

    const value = requireResponseData({ ok: true }, "POST /flows/process-all-shops");
    expect(value).toEqual({ ok: true });
  });

  it("formats command validation errors with localized text", async () => {
    const { ctx, reply } = createContext();
    await replyWithError(ctx, createBotCommandError("FIELD_MUST_NOT_BE_EMPTY", { field: "name" }));

    expect(reply).toHaveBeenCalledWith("name must not be empty");
  });
});
