import { describe, expect, it } from "vitest";
import { udloDirectoryPathForDataCloud } from "../src/data-cloud/udlo.js";

describe("udloDirectoryPathForDataCloud", () => {
  it("returns empty for blank root", () => {
    expect(udloDirectoryPathForDataCloud("")).toBe("");
    expect(udloDirectoryPathForDataCloud("  ")).toBe("");
  });

  it("appends trailing slash when missing", () => {
    expect(udloDirectoryPathForDataCloud("afd360")).toBe("afd360/");
    expect(udloDirectoryPathForDataCloud("data/files")).toBe("data/files/");
  });

  it("keeps a single trailing slash", () => {
    expect(udloDirectoryPathForDataCloud("afd360/")).toBe("afd360/");
  });
});
