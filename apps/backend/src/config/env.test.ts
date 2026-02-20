import { afterEach, describe, expect, it } from "vitest";

import { readPositiveNumberEnv, readRuntimeEnv } from "./env.js";

describe("backend env helpers", () => {
  afterEach(() => {
    delete process.env.TEST_ENV_KEY;
    delete process.env.TEST_NUMERIC_ENV;
  });

  it("reads runtime env from process.env by default", () => {
    process.env.TEST_ENV_KEY = "value-from-process";

    expect(readRuntimeEnv("TEST_ENV_KEY")).toBe("value-from-process");
  });

  it("parses positive numeric env values and falls back for invalid inputs", () => {
    process.env.TEST_NUMERIC_ENV = "42";
    expect(readPositiveNumberEnv("TEST_NUMERIC_ENV", 10)).toBe(42);

    process.env.TEST_NUMERIC_ENV = "-1";
    expect(readPositiveNumberEnv("TEST_NUMERIC_ENV", 10)).toBe(10);

    process.env.TEST_NUMERIC_ENV = "not-a-number";
    expect(readPositiveNumberEnv("TEST_NUMERIC_ENV", 10)).toBe(10);
  });
});
