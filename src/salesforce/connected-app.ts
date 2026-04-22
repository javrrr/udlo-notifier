import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SfConnection } from "../auth/sf-auth.js";
import { createRetrieveTempDir } from "../state.js";

export const CONNECTED_APP_NAME = "UDLO_Notifier";
const PLACEHOLDER = "__CERTIFICATE_PEM__";
const TEMPLATE_REL = join("force-app", "main", "default", "connectedApps", `${CONNECTED_APP_NAME}.connectedApp-meta.xml`);

function sf(args: string[]): string {
  try {
    return execFileSync("sf", args, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 10 * 1024 * 1024 });
  } catch (e: unknown) {
    const err = e as { stderr?: Buffer | string; stdout?: Buffer | string };
    const detail = [err.stdout?.toString().trim(), err.stderr?.toString().trim()].filter(Boolean).join("\n");
    throw new Error(`sf ${args.join(" ")} failed: ${detail || String(e)}`);
  }
}

function readConsumerKey(conn: SfConnection): string {
  const dir = createRetrieveTempDir(process.cwd());
  try {
    sf(["project", "retrieve", "start", "--metadata", `ConnectedApp:${CONNECTED_APP_NAME}`, "--target-org", conn.username, "--output-dir", dir, "--json"]);
    const xmlPath = join(dir, "connectedApps", `${CONNECTED_APP_NAME}.connectedApp-meta.xml`);
    if (!existsSync(xmlPath)) {
      throw new Error(`Retrieved metadata missing: ${xmlPath}`);
    }
    const key = readFileSync(xmlPath, "utf-8").match(/<consumerKey>\s*([^<]+?)\s*<\/consumerKey>/)?.[1]?.trim();
    if (!key) throw new Error("Connected App metadata missing consumerKey");
    return key;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function findExistingConnectedApp(conn: SfConnection): Promise<string | null> {
  const out = sf([
    "data",
    "query",
    "--query",
    `SELECT Id FROM ConnectedApplication WHERE DeveloperName='${CONNECTED_APP_NAME}'`,
    "--use-tooling-api",
    "--target-org",
    conn.username,
    "--json",
  ]);
  const parsed = JSON.parse(out) as { result?: { totalSize?: number } };
  if ((parsed.result?.totalSize ?? 0) < 1) return null;
  return readConsumerKey(conn);
}

export async function deployConnectedApp(conn: SfConnection, crtPath: string, pluginRoot: string): Promise<string> {
  const template = readFileSync(join(pluginRoot, TEMPLATE_REL), "utf-8");
  if (!template.includes(PLACEHOLDER)) throw new Error(`Template missing ${PLACEHOLDER}`);
  const cert = readFileSync(crtPath, "utf-8").trim();
  const injected = template.replace(PLACEHOLDER, cert);

  const pack = join(tmpdir(), `udlo-ca-${process.pid}-${Date.now()}`);
  const appDir = join(pack, "force-app", "main", "default", "connectedApps");
  mkdirSync(appDir, { recursive: true });
  writeFileSync(join(appDir, `${CONNECTED_APP_NAME}.connectedApp-meta.xml`), injected);

  try {
    sf(["project", "deploy", "start", "--source-dir", appDir, "--target-org", conn.username, "--wait", "10", "--json"]);
  } finally {
    rmSync(pack, { recursive: true, force: true });
  }
  return readConsumerKey(conn);
}
