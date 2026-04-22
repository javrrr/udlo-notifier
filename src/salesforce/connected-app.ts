import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SfConnection } from "../auth/sf-auth.js";
import { createRetrieveTempDir } from "../state.js";

const CONNECTED_APP_NAME = "UDLO_Notifier";
const PLACEHOLDER = "__CERTIFICATE_PEM__";
const TEMPLATE_REL = join("force-app", "main", "default", "connectedApps", `${CONNECTED_APP_NAME}.connectedApp-meta.xml`);

function runSf(args: string[]): string {
  try {
    return execFileSync("sf", args, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch (e: unknown) {
    const err = e as { stderr?: Buffer | string; stdout?: Buffer | string };
    const stderr = typeof err.stderr === "string" ? err.stderr : err.stderr?.toString();
    const stdout = typeof err.stdout === "string" ? err.stdout : err.stdout?.toString();
    const detail = [stdout?.trim(), stderr?.trim()].filter(Boolean).join("\n");
    throw new Error(`sf ${args.join(" ")} failed: ${detail || String(e)}`);
  }
}

function parseToolingQueryTotalSize(jsonRaw: string): number {
  const j = JSON.parse(jsonRaw) as {
    status: number;
    result?: { totalSize: number };
  };
  if (j.status !== 0 || !j.result) {
    return 0;
  }
  return j.result.totalSize;
}

function parseConsumerKeyFromConnectedAppXml(xml: string): string | null {
  const m = xml.match(/<consumerKey>\s*([^<]+?)\s*<\/consumerKey>/);
  const key = m?.[1]?.trim();
  return key && key.length > 0 ? key : null;
}

/**
 * Reads the consumer key from retrieved Connected App metadata (Tooling SOQL no longer exposes ConsumerKey).
 * Retrieve output goes under `.udlo-notifier/` in the DX project so `sf project retrieve --output-dir` stays
 * inside the Salesforce project root.
 */
function readConsumerKeyFromOrg(conn: SfConnection): string {
  const retDir = createRetrieveTempDir(process.cwd());
  try {
    runSf([
      "project",
      "retrieve",
      "start",
      "--metadata",
      `ConnectedApp:${CONNECTED_APP_NAME}`,
      "--target-org",
      conn.username,
      "--output-dir",
      retDir,
      "--json",
    ]);
    const xmlPath = join(retDir, "connectedApps", `${CONNECTED_APP_NAME}.connectedApp-meta.xml`);
    if (!existsSync(xmlPath)) {
      throw new Error(
        `Expected retrieved metadata at ${xmlPath}. Check that ConnectedApp:${CONNECTED_APP_NAME} exists in the org.`,
      );
    }
    const xml = readFileSync(xmlPath, "utf-8");
    const key = parseConsumerKeyFromConnectedAppXml(xml);
    if (!key) {
      throw new Error("Retrieved Connected App metadata did not contain a consumerKey element.");
    }
    return key;
  } finally {
    rmSync(retDir, { recursive: true, force: true });
  }
}

export async function findExistingConnectedApp(conn: SfConnection): Promise<string | null> {
  const out = runSf([
    "data",
    "query",
    "--query",
    `SELECT Id FROM ConnectedApplication WHERE DeveloperName='${CONNECTED_APP_NAME}'`,
    "--use-tooling-api",
    "--target-org",
    conn.username,
    "--json",
  ]);
  if (parseToolingQueryTotalSize(out) < 1) {
    return null;
  }
  return readConsumerKeyFromOrg(conn);
}

function buildInjectedMetadata(pluginRoot: string, crtPath: string): string {
  const templatePath = join(pluginRoot, TEMPLATE_REL);
  const template = readFileSync(templatePath, "utf-8");
  if (!template.includes(PLACEHOLDER)) {
    throw new Error(`Connected app template must contain ${PLACEHOLDER} for certificate injection`);
  }
  const certPem = readFileSync(crtPath, "utf-8").trim();
  return template.replace(PLACEHOLDER, certPem);
}

export async function deployConnectedApp(
  conn: SfConnection,
  crtPath: string,
  pluginRoot: string,
): Promise<string> {
  const injected = buildInjectedMetadata(pluginRoot, crtPath);
  const packRoot = join(tmpdir(), `udlo-connected-app-${process.pid}-${Date.now()}`);
  const connectedAppsDir = join(packRoot, "force-app", "main", "default", "connectedApps");
  mkdirSync(connectedAppsDir, { recursive: true });
  const deployedFile = join(connectedAppsDir, `${CONNECTED_APP_NAME}.connectedApp-meta.xml`);
  writeFileSync(deployedFile, injected, "utf-8");

  try {
    const deployOut = runSf([
      "project",
      "deploy",
      "start",
      "--source-dir",
      connectedAppsDir,
      "--target-org",
      conn.username,
      "--wait",
      "10",
      "--json",
    ]);
    const deployJson = JSON.parse(deployOut) as { status: number; message?: string };
    if (deployJson.status !== 0) {
      throw new Error(deployJson.message ?? "Salesforce deploy failed");
    }
  } finally {
    rmSync(packRoot, { recursive: true, force: true });
  }

  return readConsumerKeyFromOrg(conn);
}

export async function destroyConnectedApp(conn: SfConnection): Promise<void> {
  try {
    runSf([
      "project",
      "delete",
      "source",
      "--metadata",
      `ConnectedApp:${CONNECTED_APP_NAME}`,
      "--target-org",
      conn.username,
      "--no-prompt",
      "--json",
    ]);
  } catch {
    // Org may already have the component removed; treat as best-effort teardown
  }
}
