import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadLambdaZipFromPath } from "../src/aws/lambda.js";

describe("loadLambdaZipFromPath", () => {
  it("reads bytes from a file", () => {
    const dir = mkdtempSync(join(tmpdir(), "udlo-lambda-"));
    const p = join(dir, "x.zip");
    writeFileSync(p, Buffer.from([9, 8, 7]));
    expect(Buffer.compare(loadLambdaZipFromPath(p), Buffer.from([9, 8, 7]))).toBe(0);
  });

  it("throws when file is missing", () => {
    expect(() => loadLambdaZipFromPath(join(tmpdir(), "nope-not-there-999.zip"))).toThrow(/not found/);
  });
});
