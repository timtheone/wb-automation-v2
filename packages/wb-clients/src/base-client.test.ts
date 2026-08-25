import { describe, expect, it } from "vitest";

import { createWbFbsClient } from "./fbs-client.js";

describe("WB base client transport errors", () => {
  it("includes request context and the underlying network error", async () => {
    const cause = Object.assign(new Error("other side closed"), {
      code: "UND_ERR_SOCKET"
    });
    const client = createWbFbsClient({
      token: "test-token",
      fetch: async () => {
        throw new TypeError("fetch failed", { cause });
      }
    });

    await expect(client.GET("/api/v3/orders/new")).rejects.toThrow(
      "WB API transport failed (GET https://marketplace-api.wildberries.ru/api/v3/orders/new): fetch failed (cause: other side closed; code: UND_ERR_SOCKET)"
    );
  });
});
