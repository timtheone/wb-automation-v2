import { describe, expect, it } from "vitest";
import { isPhaseOneReady } from "./index.js";

describe("phase one scaffold", () => {
  it("returns true", () => {
    expect(isPhaseOneReady()).toBe(true);
  });
});
