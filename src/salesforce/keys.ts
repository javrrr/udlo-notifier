import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function ensureKeyPair(outputDir: string): { pemPath: string; crtPath: string } {
  mkdirSync(outputDir, { recursive: true });
  const pemPath = join(outputDir, "keypair.pem");
  const crtPath = join(outputDir, "certificate.crt");

  if (existsSync(pemPath) && existsSync(crtPath)) {
    return { pemPath, crtPath };
  }

  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });

  writeFileSync(pemPath, privateKey, { mode: 0o600 });

  execFileSync(
    "openssl",
    [
      "req",
      "-new",
      "-x509",
      "-key",
      pemPath,
      "-out",
      crtPath,
      "-days",
      "365",
      "-subj",
      "/CN=udlo-notifier",
    ],
    { stdio: "pipe" },
  );

  return { pemPath, crtPath };
}
