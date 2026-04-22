import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { URL } from "node:url";

const REDIRECT_URI = "http://localhost:1717/OauthRedirect";
/** Optional: set to complete the authorization_code → token exchange and validate the app. */
const CLIENT_SECRET_ENV = "SF_UDLO_CLIENT_SECRET";
/**
 * Scopes sent on the /authorize URL only (Salesforce UDLO S3 guide: user must approve api,
 * refresh_token, and cdp_ingest_api). Omitting `scope` requests every Connected App scope and can
 * trigger OAUTH_CODE_CRED_SCOPE_TOO_LONG — use UDLO_OAUTH_PREAUTH_SCOPE to trim if needed.
 *
 * @see https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-awss3-udlo.html
 */
const PREAUTH_SCOPE_ENV = "UDLO_OAUTH_PREAUTH_SCOPE";
const DEFAULT_PREAUTH_SCOPE = "api refresh_token cdp_ingest_api";

const OAUTH_TIMEOUT_MS = 300_000;

function openBrowser(url: string): void {
  const platform = process.platform;
  if (platform === "darwin") {
    execFile("open", [url], () => {});
  } else if (platform === "win32") {
    execFile("cmd", ["/c", "start", "", url], { windowsHide: true }, () => {});
  } else {
    execFile("xdg-open", [url], () => {});
  }
}

function waitForAuthorizationCode(authUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;

    const finish = (err: Error | null, code?: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      server.close(() => {
        if (err) {
          reject(err);
          return;
        }
        if (code) {
          resolve(code);
          return;
        }
        reject(new Error("OAuth finished without a code"));
      });
    };

    const server = createServer((req, res) => {
      const u = new URL(req.url ?? "/", "http://127.0.0.1:1717");
      if (u.pathname !== "/OauthRedirect") {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }

      const code = u.searchParams.get("code");
      const oauthError = u.searchParams.get("error");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        "<!doctype html><meta charset=\"utf-8\"><title>UDLO Notifier</title>" +
          "<p>Authorization complete. You can close this window.</p>",
      );

      if (oauthError) {
        finish(
          new Error(
            `OAuth error: ${oauthError} ${u.searchParams.get("error_description") ?? ""}`.trim(),
          ),
        );
        return;
      }
      if (!code) {
        finish(new Error("OAuth callback missing authorization code"));
        return;
      }
      finish(null, code);
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        finish(
          new Error(
            "Port 1717 is already in use. Stop the other process using it so the OAuth callback can run.",
          ),
        );
      } else {
        finish(err);
      }
    });

    timer = setTimeout(() => {
      finish(new Error("OAuth timed out waiting for the browser callback"));
    }, OAUTH_TIMEOUT_MS);

    server.listen(1717, "127.0.0.1", () => {
      openBrowser(authUrl);
    });
  });
}

async function exchangeCodeForTokens(
  loginBaseUrl: string,
  consumerKey: string,
  code: string,
): Promise<void> {
  const secret = process.env[CLIENT_SECRET_ENV];
  if (!secret) {
    console.log(
      `[udlo-notifier] Authorization code received. Export ${CLIENT_SECRET_ENV} to run the token exchange automatically, ` +
        "or confirm access in the org if your Connected App policy does not require it.",
    );
    return;
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: consumerKey,
    client_secret: secret,
    redirect_uri: REDIRECT_URI,
  });

  const tokenUrl = `${loginBaseUrl}/services/oauth2/token`;
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }
  console.log("[udlo-notifier] Connected app pre-authorization succeeded (token exchange completed).");
}

export async function authorizeConnectedApp(loginUrl: string, consumerKey: string): Promise<void> {
  const base = loginUrl.replace(/\/+$/, "");
  const scope = process.env[PREAUTH_SCOPE_ENV] ?? DEFAULT_PREAUTH_SCOPE;
  const authUrl =
    `${base}/services/oauth2/authorize?response_type=code&client_id=${encodeURIComponent(consumerKey)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=${encodeURIComponent(scope)}`;

  const code = await waitForAuthorizationCode(authUrl);
  await exchangeCodeForTokens(base, consumerKey, code);
}
