import type { Context } from "hono";
import { describe, expect, it } from "vitest";

import {
  readTelegramRequestContext,
  TELEGRAM_CHAT_ID_HEADER,
  TELEGRAM_CHAT_TYPE_HEADER,
  TELEGRAM_OWNER_USER_ID_HEADER,
  TELEGRAM_USER_ID_HEADER
} from "./telegram-context.js";
import { RequestValidationError } from "./validation.js";

describe("telegram context security validation", () => {
  it("parses a valid context", () => {
    const context = createContext({
      [TELEGRAM_CHAT_ID_HEADER]: "777",
      [TELEGRAM_CHAT_TYPE_HEADER]: "group",
      [TELEGRAM_USER_ID_HEADER]: "123",
      [TELEGRAM_OWNER_USER_ID_HEADER]: "999"
    });

    expect(readTelegramRequestContext(context)).toEqual({
      chatId: 777,
      chatType: "group",
      requesterTelegramUserId: 123,
      ownerTelegramUserId: 999
    });
  });

  it("rejects owner/requester mismatch in private chats", () => {
    const context = createContext({
      [TELEGRAM_CHAT_ID_HEADER]: "10",
      [TELEGRAM_CHAT_TYPE_HEADER]: "private",
      [TELEGRAM_USER_ID_HEADER]: "100",
      [TELEGRAM_OWNER_USER_ID_HEADER]: "200"
    });

    const error = captureError(() => readTelegramRequestContext(context));

    expect(error).toBeInstanceOf(RequestValidationError);
    expect((error as RequestValidationError).code).toBe("TELEGRAM_PRIVATE_OWNER_MISMATCH");
  });

  it("rejects missing or invalid telegram headers", () => {
    const context = createContext({
      [TELEGRAM_CHAT_ID_HEADER]: "not-a-number",
      [TELEGRAM_CHAT_TYPE_HEADER]: "group"
    });

    const error = captureError(() => readTelegramRequestContext(context));

    expect(error).toBeInstanceOf(RequestValidationError);
    expect((error as RequestValidationError).code).toBe("TELEGRAM_CONTEXT_INVALID");
  });
});

function createContext(headers: Record<string, string>): Context {
  const lowerCaseHeaders = new Map(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );

  return {
    req: {
      header(name: string) {
        return lowerCaseHeaders.get(name.toLowerCase());
      }
    }
  } as unknown as Context;
}

function captureError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }

  throw new Error("Expected function to throw");
}
