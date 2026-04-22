import { existsSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { bundledLambdaZipPath, loadLambdaZipFromPath, resolveLambdaZipPath } from "../src/aws/lambda.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

describe("resolveLambdaZipPath", () => {
  it("leaves absolute paths unchanged", () => {
    expect(resolveLambdaZipPath("/tmp/x.zip")).toBe("/tmp/x.zip");
  });

  it("resolves relative paths against cwd", () => {
    const dir = mkdtempSync(join(tmpdir(), "udlo-lambda-cwd-"));
    const prev = process.cwd();
    try {
      process.chdir(dir);
      writeFileSync("rel.zip", Buffer.from([1]));
      expect(realpathSync(resolveLambdaZipPath("rel.zip"))).toBe(realpathSync(join(dir, "rel.zip")));
    } finally {
      process.chdir(prev);
    }
  });
});

describe("bundledLambdaZipPath", () => {
  it("points at the stock zip in this repo", () => {
    const p = bundledLambdaZipPath(repoRoot);
    expect(p).toMatch(/aws_lambda_function\.zip$/);
    expect(existsSync(p)).toBe(true);
    expect(loadLambdaZipFromPath(p).length).toBeGreaterThan(500);
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
