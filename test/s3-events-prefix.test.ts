import { describe, expect, it } from "vitest";
import { s3KeyPrefixForNotifications } from "../src/aws/s3-events.js";

describe("s3KeyPrefixForNotifications", () => {
  it("returns empty for blank root", () => {
    expect(s3KeyPrefixForNotifications("")).toBe("");
    expect(s3KeyPrefixForNotifications("  ")).toBe("");
  });

  it("appends trailing slash when missing", () => {
    expect(s3KeyPrefixForNotifications("afd360")).toBe("afd360/");
    expect(s3KeyPrefixForNotifications("data/files")).toBe("data/files/");
  });

  it("keeps a single trailing slash", () => {
    expect(s3KeyPrefixForNotifications("afd360/")).toBe("afd360/");
  });
});
