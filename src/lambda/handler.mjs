import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { createPrivateKey, createPublicKey, createSign, createHash } from "node:crypto";

const sm = new SecretsManagerClient({});
let cached;

const log = (...args) => console.log("[udlo]", ...args);

async function getSecret(id) {
  const r = await sm.send(new GetSecretValueCommand({ SecretId: id }));
  if (!r.SecretString) throw new Error(`Secret ${id} has no SecretString`);
  return r.SecretString;
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function keyFingerprint(pem) {
  const pub = createPublicKey(createPrivateKey({ key: pem })).export({ type: "spki", format: "der" });
  return createHash("sha256").update(pub).digest("hex").slice(0, 16);
}

function signJwt(iss, sub, aud, pem) {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const exp = Math.floor(Date.now() / 1000) + 3000;
  const payload = { iss, sub, aud, exp };
  const payloadEnc = b64url(JSON.stringify(payload));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payloadEnc}`);
  const key = createPrivateKey({ key: pem });
  log("jwt claims", { iss: `${iss.slice(0, 12)}…`, sub, aud, exp });
  log("jwt key fingerprint (sha256, first 16)", keyFingerprint(pem));
  return { jwt: `${header}.${payloadEnc}.${b64url(signer.sign(key))}`, exp };
}

async function postForm(url, form) {
  const body = new URLSearchParams(form);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    log("POST failed", { url, status: res.status, body: text.slice(0, 2000) });
    throw new Error(`POST ${url} ${res.status}: ${text.slice(0, 500)}`);
  }
  log("POST ok", { url, status: res.status });
  return JSON.parse(text);
}

async function getCdpToken() {
  if (cached && Date.now() / 1000 < cached.exp - 60) {
    log("token cache hit");
    return cached;
  }
  log("token cache miss");

  const login = process.env.SF_LOGIN_URL.replace(/\/+$/, "");
  const username = process.env.SF_USERNAME;
  const consumerKeyId = process.env.CONSUMER_KEY;
  const rsaKeyId = process.env.RSA_PRIVATE_KEY;
  log("env", { login, username, consumerKeyId, rsaKeyId });

  const [consumerKey, pem] = await Promise.all([getSecret(consumerKeyId), getSecret(rsaKeyId)]);
  log("secrets fetched", { consumerKeyLen: consumerKey.length, pemLen: pem.length });

  const { jwt, exp } = signJwt(consumerKey, username, login, pem);

  const core = await postForm(`${login}/services/oauth2/token`, {
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: jwt,
  });
  log("core token", {
    instance_url: core.instance_url,
    scope: core.scope,
    token_type: core.token_type,
    access_token_len: core.access_token?.length ?? 0,
  });

  const cdp = await postForm(`${core.instance_url}/services/a360/token`, {
    grant_type: "urn:salesforce:grant-type:external:cdp",
    subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
    subject_token: core.access_token,
  });
  const accessToken = cdp.access_token ?? cdp.accessToken;
  const instanceUrl = cdp.instance_url ?? cdp.instanceUrl;
  if (!accessToken || !instanceUrl) {
    throw new Error(`CDP token missing fields: keys=${JSON.stringify(Object.keys(cdp))}`);
  }
  log("cdp token ok", { instanceUrl, access_token_len: accessToken.length });

  cached = { accessToken, instanceUrl, exp };
  return cached;
}

export const handler = async (event) => {
  log("event", { records: event?.Records?.length ?? 0, keys: Object.keys(event ?? {}) });
  const { accessToken, instanceUrl } = await getCdpToken();
  const host = instanceUrl.replace(/^https?:\/\//, "").split("/")[0];
  const url = `https://${host}/api/v1/unstructuredIngest?sourceType=aws`;
  log("ingest POST", url);
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
  const text = await res.text();
  if (!res.ok) {
    log("ingest failed", { status: res.status, body: text.slice(0, 2000) });
    throw new Error(`ingest ${res.status}: ${text.slice(0, 500)}`);
  }
  log("ingest ok", text.slice(0, 500));
  return { accepted: true };
};
