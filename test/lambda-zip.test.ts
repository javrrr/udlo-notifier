import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadLambdaZipFromEnv, loadLambdaZipFromPath } from "../src/aws/lambda.js";

describe("loadLambdaZipFromEnv", () => {
  let prev: string | undefined;

  beforeEach(() => {
    prev = process.env.UDLO_LAMBDA_ZIP_PATH;
  });

  afterEach(() => {
    if (prev === undefined) {
      delete process.env.UDLO_LAMBDA_ZIP_PATH;
    } else {
      process.env.UDLO_LAMBDA_ZIP_PATH = prev;
    }
  });

  it("throws when UDLO_LAMBDA_ZIP_PATH is unset", () => {
    delete process.env.UDLO_LAMBDA_ZIP_PATH;
    expect(() => loadLambdaZipFromEnv()).toThrow(/UDLO_LAMBDA_ZIP_PATH/);
  });

  it("throws when UDLO_LAMBDA_ZIP_PATH is empty", () => {
    process.env.UDLO_LAMBDA_ZIP_PATH = "   ";
    expect(() => loadLambdaZipFromEnv()).toThrow(/UDLO_LAMBDA_ZIP_PATH/);
  });

  it("loads from path when env is set", () => {
    const dir = mkdtempSync(join(tmpdir(), "udlo-lambda-env-"));
    const p = join(dir, "pkg.zip");
    writeFileSync(p, Buffer.from([1, 2, 3]));
    process.env.UDLO_LAMBDA_ZIP_PATH = p;
    expect(Buffer.compare(loadLambdaZipFromEnv(), Buffer.from([1, 2, 3]))).toBe(0);
  });
});

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
