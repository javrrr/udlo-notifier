import { describe, expect, it } from "vitest";
import { sleep, uniqueSuffix } from "../src/helpers.js";

describe("helpers", () => {
  it("uniqueSuffix returns non-empty string", () => {
    expect(uniqueSuffix().length).toBeGreaterThan(0);
  });

  it("sleep resolves after delay", async () => {
    const start = Date.now();
    await sleep(15);
    expect(Date.now() - start).toBeGreaterThanOrEqual(10);
  });
});
