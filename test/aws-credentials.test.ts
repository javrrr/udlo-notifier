import { describe, expect, it, vi } from "vitest";
import { verifyAwsCredentials } from "../src/aws/credentials.js";

describe("verifyAwsCredentials", () => {
  it("returns account id and arn from STS", async () => {
    const stsClient = {
      send: vi.fn().mockResolvedValue({
        Account: "123456789012",
        Arn: "arn:aws:sts::123456789012:assumed-role/Admin/session",
      }),
    };
    const out = await verifyAwsCredentials(stsClient as never);
    expect(out).toEqual({
      accountId: "123456789012",
      arn: "arn:aws:sts::123456789012:assumed-role/Admin/session",
    });
  });

  it("throws when Account is missing", async () => {
    const stsClient = {
      send: vi.fn().mockResolvedValue({ Arn: "arn:x" }),
    };
    await expect(verifyAwsCredentials(stsClient as never)).rejects.toThrow(/no Account/);
  });
});
