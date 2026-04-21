import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureKeyPair } from "../src/salesforce/keys.js";

function hasOpenssl(): boolean {
  try {
    execSync("openssl version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const openssl = hasOpenssl();

describe.skipIf(!openssl)("keys", () => {
  let dir: string;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("creates PEM and CRT and is idempotent when both exist", () => {
    dir = mkdtempSync(join(tmpdir(), "udlo-keys-"));
    const first = ensureKeyPair(dir);
    expect(first.pemPath).toMatch(/keypair\.pem$/);
    expect(first.crtPath).toMatch(/certificate\.crt$/);
    expect(readFileSync(first.pemPath, "utf-8")).toContain("BEGIN PRIVATE KEY");
    expect(readFileSync(first.crtPath, "utf-8")).toContain("BEGIN CERTIFICATE");

    const second = ensureKeyPair(dir);
    expect(second.pemPath).toBe(first.pemPath);
    expect(second.crtPath).toBe(first.crtPath);
  });
});
