import { describe, expect, it } from "vitest";
import { s3KeyPrefix } from "../src/aws/s3-events.js";

describe("s3KeyPrefix", () => {
  it("returns empty for blank root", () => {
    expect(s3KeyPrefix("")).toBe("");
    expect(s3KeyPrefix("  ")).toBe("");
  });

  it("appends trailing slash", () => {
    expect(s3KeyPrefix("afd360")).toBe("afd360/");
    expect(s3KeyPrefix("data/files")).toBe("data/files/");
  });

  it("keeps a single trailing slash", () => {
    expect(s3KeyPrefix("afd360/")).toBe("afd360/");
  });
});
