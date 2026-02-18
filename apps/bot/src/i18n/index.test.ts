import { describe, expect, it } from "vitest";

import { createTranslator, resolveLocale } from "./index.js";

describe("resolveLocale", () => {
  it("returns ru for russian telegram locale", () => {
    expect(resolveLocale("ru")).toBe("ru");
    expect(resolveLocale("ru-RU")).toBe("ru");
  });

  it("falls back to en for unsupported locales", () => {
    expect(resolveLocale("es")).toBe("en");
    expect(resolveLocale(undefined)).toBe("en");
  });
});

describe("createTranslator", () => {
  it("uses russian overrides when present", () => {
    const t = createTranslator("ru");
    expect(t.shops.menuTitle()).toBe("Меню магазинов");
  });

  it("falls back to english when russian key is missing", () => {
    const t = createTranslator("ru");
    expect(t.ping.pong()).toBe("pong");
  });
});
