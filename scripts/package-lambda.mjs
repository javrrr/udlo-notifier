#!/usr/bin/env node
/**
 * Build dist/lambda-local.zip from aws_lambda_function/ (same layout Lambda expects at zip root).
 * Requires the `zip` CLI (macOS, Linux, WSL).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "aws_lambda_function");
const outDir = join(root, "dist");
const outZip = join(outDir, "lambda-local.zip");

if (!existsSync(srcDir)) {
  console.error(`Missing ${srcDir} — clone or vendor the Lambda tree before packaging.`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
if (existsSync(outZip)) {
  try {
    unlinkSync(outZip);
  } catch {
    /* ignore */
  }
}

console.error(`Packaging ${srcDir} → ${outZip}`);
execFileSync("zip", ["-qr", outZip, "."], { cwd: srcDir, stdio: "inherit" });
console.error("Done.");
