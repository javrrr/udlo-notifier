import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { join } from "node:path";

export interface KeyPair {
  pemPath: string;
  crtPath: string;
  /** True when this call generated a new key pair (caller must redeploy the cert to any Connected App that uses it). */
  generated: boolean;
}

export function ensureKeyPair(dir: string): KeyPair {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const pemPath = join(dir, "keypair.pem");
  const crtPath = join(dir, "certificate.crt");
  if (existsSync(pemPath) && existsSync(crtPath)) return { pemPath, crtPath, generated: false };

  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  writeFileSync(pemPath, privateKey, { mode: 0o600 });

  execFileSync("openssl", ["req", "-new", "-x509", "-key", pemPath, "-out", crtPath, "-days", "365", "-subj", "/CN=udlo-notifier"], {
    stdio: "pipe",
  });
  return { pemPath, crtPath, generated: true };
}
