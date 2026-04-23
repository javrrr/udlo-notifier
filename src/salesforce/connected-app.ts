import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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

const MANIFEST_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
  <types>
    <members>${CONNECTED_APP_NAME}</members>
    <name>ConnectedApp</name>
  </types>
  <version>66.0</version>
</Package>
`;

function findMetadataFile(dir: string, filename: string): string | null {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findMetadataFile(p, filename);
      if (found) return found;
    } else if (entry.name === filename) {
      return p;
    }
  }
  return null;
}

/**
 * Retrieves the ConnectedApp metadata and extracts its consumerKey. Uses a manifest +
 * `--target-metadata-dir --unzip` so the retrieve bypasses the consumer project's
 * source-filter (which would otherwise return zero files when UDLO_Notifier isn't
 * already present in the consumer's force-app/). The metadata dir must live inside
 * the consumer project root — `sf` CLI enforces this.
 */
function readConsumerKey(conn: SfConnection): string {
  const dir = createRetrieveTempDir(process.cwd());
  try {
    const manifestPath = join(dir, "package.xml");
    writeFileSync(manifestPath, MANIFEST_XML);
    sf([
      "project",
      "retrieve",
      "start",
      "--manifest",
      manifestPath,
      "--target-org",
      conn.username,
      "--target-metadata-dir",
      dir,
      "--unzip",
      "--json",
    ]);
    const xmlPath = findMetadataFile(dir, `${CONNECTED_APP_NAME}.connectedApp`);
    if (!xmlPath) {
      throw new Error(
        `ConnectedApp ${CONNECTED_APP_NAME} not found in org after retrieve. ` +
          "Check that the deploy step succeeded (Setup > App Manager > UDLO Notifier in the Salesforce org).",
      );
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
