import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LAMBDA_ZIP_URL, fetchLambdaZip } from "../src/aws/lambda.js";

describe("fetchLambdaZip", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns response body as Buffer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => "3" },
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        text: async () => "",
      }),
    );
    const buf = await fetchLambdaZip("https://example.com/lambda.zip");
    expect(Buffer.compare(buf, Buffer.from([1, 2, 3]))).toBe(0);
  });

  it("throws on non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        headers: { get: () => null },
        text: async () => "missing",
      }),
    );
    await expect(fetchLambdaZip("https://example.com/missing.zip")).rejects.toThrow(/404/);
  });

  it("default URL points at forcedotcom raw zip", () => {
    expect(DEFAULT_LAMBDA_ZIP_URL).toContain("raw.githubusercontent.com/forcedotcom/file-notifier-for-blob-store");
    expect(DEFAULT_LAMBDA_ZIP_URL).toContain("aws_lambda_function.zip");
  });
});
