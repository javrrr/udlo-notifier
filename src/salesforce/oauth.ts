import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";

const REDIRECT_URI = "http://localhost:1717/OauthRedirect";
const SCOPE = "api refresh_token cdp_ingest_api";
const CALLBACK_TIMEOUT_MS = 300_000;

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  execFile(cmd, args, () => {});
}

/**
 * Listen on localhost:1717 for the Salesforce OAuth callback, show a success page, and resolve
 * once the browser delivers a `code` (or an `error`). JWT bearer flow doesn't need the code
 * exchanged for tokens — the app just needs user consent to have happened.
 */
export function waitForOAuthCallback(): Promise<void> {
  return new Promise((resolve, reject) => {
    let server: Server;
    let settled = false;

    const finish = (err?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close(() => (err ? reject(err) : resolve()));
    };

    const timer = setTimeout(
      () => finish(new Error("Timed out waiting for the OAuth browser callback")),
      CALLBACK_TIMEOUT_MS,
    );

    server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1:1717");
      if (url.pathname !== "/OauthRedirect") {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      res.writeHead(error ? 400 : 200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        `<!doctype html><meta charset="utf-8"><title>UDLO Notifier</title>` +
          `<style>body{font-family:system-ui;margin:4rem auto;max-width:32rem;text-align:center}</style>` +
          (error
            ? `<h1>Authorization failed</h1><p>${error}: ${url.searchParams.get("error_description") ?? ""}</p>`
            : `<h1>Authorized ✓</h1><p>You can close this window.</p>`),
      );
      if (error) {
        finish(new Error(`OAuth error: ${error} ${url.searchParams.get("error_description") ?? ""}`.trim()));
      } else if (code) {
        finish();
      } else {
        finish(new Error("OAuth callback missing both code and error"));
      }
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      finish(
        err.code === "EADDRINUSE"
          ? new Error("Port 1717 is already in use. Stop the other process so the OAuth callback can run.")
          : err,
      );
    });

    server.listen(1717, "127.0.0.1");
  });
}

export async function authorizeConnectedApp(loginBase: string, consumerKey: string): Promise<string> {
  const base = loginBase.replace(/\/+$/, "");
  const url = `${base}/services/oauth2/authorize?response_type=code&client_id=${encodeURIComponent(consumerKey)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(SCOPE)}`;
  const wait = waitForOAuthCallback();
  openBrowser(url);
  await wait;
  return url;
}
