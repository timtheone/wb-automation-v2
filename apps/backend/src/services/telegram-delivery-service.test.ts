import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  botToken: undefined as string | undefined
}));

vi.mock("../config/env.js", async () => {
  return {
    readRuntimeEnv: (key: string) => {
      if (key === "BOT_TOKEN") {
        return testState.botToken;
      }

      return undefined;
    }
  };
});

vi.mock("../logger.js", async () => {
  return {
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  };
});

import { createTelegramDeliveryService } from "./telegram-delivery-service.js";

describe("telegram delivery service", () => {
  beforeEach(() => {
    testState.botToken = "test-token";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("sends combined-pdf artifacts and localized completion messages", async () => {
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const service = createTelegramDeliveryService();

    await service.sendCombinedPdfGenerated(
      987,
      {
        startedAt: new Date("2026-02-20T10:00:00.000Z"),
        finishedAt: new Date("2026-02-20T10:00:10.000Z"),
        processedShops: 2,
        successCount: 2,
        skippedCount: 0,
        failureCount: 0,
        totalOrdersCollected: 14,
        orderListFileName: "orders.pdf",
        stickersFileName: "stickers.pdf",
        orderListPdfBase64: "aGVsbG8=",
        stickersPdfBase64: "aGVsbG8=",
        results: []
      },
      "ru"
    );

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit | undefined]>;

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(calls[0]?.[0]).toBe("https://api.telegram.org/bottest-token/sendMessage");
    expect(calls[1]?.[0]).toBe("https://api.telegram.org/bottest-token/sendDocument");
    expect(calls[2]?.[0]).toBe("https://api.telegram.org/bottest-token/sendDocument");
    expect(calls[3]?.[0]).toBe("https://api.telegram.org/bottest-token/sendMessage");

    const firstMessageBody = JSON.parse(String(calls[0]?.[1]?.body)) as {
      text: string;
    };
    const finalMessageBody = JSON.parse(String(calls[3]?.[1]?.body)) as {
      text: string;
    };

    expect(firstMessageBody.text).toContain("Генерация PDF завершена");
    expect(finalMessageBody.text).toContain("Собрано заказов: 14");
  });

  it("skips token warning delivery when there are no warnings", async () => {
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const service = createTelegramDeliveryService();
    await service.sendWbTokenExpirationWarnings(321, []);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("infers locale from Telegram profile when warning language is not provided", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, result: { user: { language_code: "ru" } } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    vi.stubGlobal("fetch", fetchMock);

    const service = createTelegramDeliveryService();
    await service.sendWbTokenExpirationWarnings(654, [
      {
        shopId: "shop-1",
        shopName: "Shop One",
        tokenType: "production",
        expiresAt: new Date("2026-02-22T00:00:00.000Z"),
        daysLeft: 2
      }
    ]);

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit | undefined]>;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(calls[0]?.[0]).toBe("https://api.telegram.org/bottest-token/getChatMember");
    expect(calls[1]?.[0]).toBe("https://api.telegram.org/bottest-token/sendMessage");

    const warningMessageBody = JSON.parse(String(calls[1]?.[1]?.body)) as {
      text: string;
    };
    expect(warningMessageBody.text).toContain("Срок действия WB токена скоро истечет");
    expect(warningMessageBody.text).toContain("Shop One");
  });

  it("throws descriptive error when Telegram API returns non-2xx", async () => {
    const fetchMock = vi.fn(async () => new Response("gateway failure", { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);

    const service = createTelegramDeliveryService();

    await expect(service.sendCombinedPdfFailed(111, "boom", "en")).rejects.toThrow(
      "Telegram API sendMessage failed with status 502"
    );
  });

  it("returns throwing stubs when BOT_TOKEN is missing", async () => {
    testState.botToken = undefined;
    const service = createTelegramDeliveryService();

    await expect(service.sendWaitingOrdersPdfFailed(1, "error", "en")).rejects.toThrow(
      "BOT_TOKEN is configured in backend environment"
    );
  });
});
