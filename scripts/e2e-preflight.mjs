#!/usr/bin/env node
/**
 * End-to-end preflight: Salesforce session → RSA keys → Connected App (deploy if missing)
 * → Data 360 client (connections list).
 *
 * Usage (from repo root):
 *   npm run test:e2e
 *   npm run test:e2e -- myOrgAlias
 *
 * Env:
 *   UDLO_E2E_SKIP_DATA360=1  — skip Data 360 API call entirely
 *   UDLO_E2E_FORCE_DEPLOY=1  — run metadata deploy even if UDLO_Notifier already exists
 *
 * Step 4 (Data 360 connections list) is best-effort: a 400 from the Connect API is common if the
 * default org session is not Data Cloud–enabled on this host; steps 1–3 still prove the pipeline.
 */

import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(__dirname, "..");
const targetOrg = process.argv[2] || undefined;

function maskKey(key) {
  if (!key || key.length < 12) {
    return "(short)";
  }
  return `${key.slice(0, 8)}…${key.slice(-4)}`;
}

async function loadDist() {
  const dist = (p) => pathToFileURL(join(pluginRoot, "dist", p)).href;
  const [{ resolveConnection }, { ensureKeyPair }, { findExistingConnectedApp, deployConnectedApp }, { createData360Client }] =
    await Promise.all([
      import(dist("auth/sf-auth.js")),
      import(dist("salesforce/keys.js")),
      import(dist("salesforce/connected-app.js")),
      import(dist("data-cloud/client.js")),
    ]);
  return { resolveConnection, ensureKeyPair, findExistingConnectedApp, deployConnectedApp, createData360Client };
}

async function main() {
  console.log("=== udlo-notifier E2E preflight (Phases 0–2 + Data360 client) ===\n");

  const { resolveConnection, ensureKeyPair, findExistingConnectedApp, deployConnectedApp, createData360Client } =
    await loadDist();

  console.log("1) Salesforce session (resolveConnection)");
  const conn = await resolveConnection(targetOrg);
  console.log(`   OK — ${conn.username}`);
  console.log(`   Instance: ${conn.instanceUrl}\n`);

  console.log("2) RSA key pair (ensureKeyPair)");
  const keysDir = join(pluginRoot, "keys");
  const { pemPath, crtPath } = ensureKeyPair(keysDir);
  console.log(`   OK — ${pemPath}`);
  console.log(`           ${crtPath}\n`);

  console.log("3) Connected App UDLO_Notifier (find or deploy)");
  let consumerKey = await findExistingConnectedApp(conn, pluginRoot);
  if (consumerKey && !process.env.UDLO_E2E_FORCE_DEPLOY) {
    console.log(`   Already in org — consumer key ${maskKey(consumerKey)} (set UDLO_E2E_FORCE_DEPLOY=1 to redeploy)\n`);
  } else {
    console.log(consumerKey ? "   Redeploying (UDLO_E2E_FORCE_DEPLOY)…\n" : "   Not found — deploying metadata…\n");
    consumerKey = await deployConnectedApp(conn, crtPath, pluginRoot);
    console.log(`   Deploy OK — consumer key ${maskKey(consumerKey)}\n`);
  }

  if (!process.env.UDLO_E2E_SKIP_DATA360) {
    console.log("4) Data 360 client — GET /ssot/connections (first page)");
    try {
      const client = createData360Client(conn);
      const page = await client.connections.list({ batchSize: 5, connectorType: "AwsS3" });
      const n = page.connections?.length ?? 0;
      const total = page.totalSize ?? "?";
      console.log(`   OK — ${n} connection(s) in page (totalSize=${total})\n`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const body = typeof e === "object" && e !== null && "body" in e ? e.body : undefined;
      const detail = body !== undefined ? ` ${JSON.stringify(body)}` : "";
      console.log(`   Warning — ${msg}${detail}`);
      console.log(
        "   (Often: org or user lacks Data Cloud on this instance URL, or Connect expects a different base URL. Steps 1–3 are still good.)\n",
      );
    }
  } else {
    console.log("4) Data 360 — skipped (UDLO_E2E_SKIP_DATA360=1)\n");
  }

  console.log("5) OAuth pre-auth (manual)");
  const loginBase = conn.instanceUrl.replace(/\/+$/, "");
  console.log(
    "   Browser flow is not run in this script. From code or REPL call authorizeConnectedApp(loginUrl, consumerKey)",
  );
  console.log(`   Example loginUrl: ${loginBase}`);
  console.log(`   Optional: export SF_UDLO_CLIENT_SECRET='<consumer secret>' for token exchange after browser consent.\n`);

  console.log("=== E2E preflight completed successfully ===");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
