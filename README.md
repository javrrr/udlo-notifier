# udlo-notifier

An **sf CLI plugin** that automates setup of an **S3 → Salesforce Data Cloud** unstructured file pipeline (UDLO path): Connected App + JWT, Data Cloud connections and lake objects, AWS Lambda, Secrets Manager, and S3 event notifications.

`sf udlo setup`, `teardown`, and `status` orchestrate the pipeline end-to-end (see `PLAN.md` Phase 5). Supporting modules cover Salesforce auth, Data Cloud (`data-360-sdk`), Connected App deploy, AWS IAM/Lambda/Secrets/S3, and `.udlo-state.json`.

## Prerequisites

| Requirement | Notes |
|-------------|--------|
| **Node.js** | `>= 20` (see `package.json` `engines`) |
| **Salesforce CLI** | `sf` with a logged-in org (`sf org login web` or similar) |
| **AWS credentials** | Environment variables, shared credentials file, or `AWS_PROFILE` — whatever the AWS SDK v3 picks up |
| **OpenSSL** | Used locally to mint the X.509 cert for the Connected App (`openssl` on `PATH`) |
| **Network** | Lambda deployment downloads a ZIP from GitHub (see below) |

## Install (development)

```bash
git clone <repository-url> udlo-notifier
cd udlo-notifier
npm install
npm run build
sf plugins link .
```

Verify the plugin:

```bash
sf udlo --help
```

## Commands

| Command | Purpose |
|---------|---------|
| `sf udlo setup` | Full pipeline: keys → Connected App (+ optional OAuth confirm) → S3 connection → UDLO → AWS (STS, IAM, Secrets, Lambda from [official ZIP](https://github.com/forcedotcom/file-notifier-for-blob-store)) → S3 notifications. Writes `.udlo-state.json` in the **current working directory**. |
| `sf udlo teardown` | Removes S3 notifications, Lambda, secrets, IAM role; optionally deletes the UDLO; clears state. Does **not** delete the Connected App. |
| `sf udlo status` | Reads `.udlo-state.json` and probes Salesforce + AWS resources. |

Examples:

```bash
sf udlo setup -o myOrg -b my-bucket -d path/to/files -n MyDocuments
sf udlo status -o myOrg
sf udlo teardown -o myOrg --auto-approve
```

Flags: run `sf udlo setup --help` (required: `--bucket`, `--directory`, `--object-name`).

## End-to-end preflight (Salesforce + keys + Connected App + Data 360 probe)

```bash
npm run test:e2e
# optional: target org alias
npm run test:e2e -- myOrgAlias
```

Environment knobs:

| Variable | Purpose |
|----------|---------|
| `UDLO_E2E_SKIP_DATA360` | Set to `1` to skip the Data 360 `connections.list` check |
| `UDLO_E2E_FORCE_DEPLOY` | Set to `1` to redeploy the Connected App even if it already exists |

## AWS Lambda deployment package

The plugin **does not** zip a local `aws_lambda_function/` tree for upload. It downloads a **published ZIP** from Salesforce’s reference repo and uploads it to Lambda.

| Item | Value |
|------|--------|
| **Default ZIP URL** | `https://raw.githubusercontent.com/forcedotcom/file-notifier-for-blob-store/main/cloud_function_zips/aws_lambda_function.zip` |
| **Override** | Set `UDLO_LAMBDA_ZIP_URL` to any HTTPS URL that returns a Lambda deployment package, or pass `lambdaZipUrl` into `ensureLambda()` in code |
| **Runtime** | **Python 3.11** — matches how Salesforce builds that ZIP (`pyenv` + Python **3.11.4** in their [`dev-help.txt`](https://github.com/forcedotcom/file-notifier-for-blob-store/blob/main/dev-help.txt)) |
| **Handler** | `unstructured_data.s3_events_handler` (must match the contents of the ZIP) |

If Lambda creation fails with handler or runtime errors, compare with the [file-notifier-for-blob-store](https://github.com/forcedotcom/file-notifier-for-blob-store) AWS function sources under `aws/` in that repository.

## Other environment variables

| Variable | Used by |
|----------|---------|
| `SF_UDLO_CLIENT_SECRET` | Optional Connected App **consumer secret** for the OAuth code → token exchange after browser consent (`src/salesforce/oauth.ts`) |

## Project layout (high level)

```
src/
  auth/sf-auth.ts           # resolveConnection() — lazy @salesforce/core
  aws/                      # STS, IAM role, Secrets Manager, Lambda (zip URL), S3 notifications
  data-cloud/               # Data360Client factory, S3 connection lookup, UDLO helpers
  salesforce/               # RSA keys, Connected App deploy/retrieve, OAuth callback on :1717
  state.ts                  # .udlo-state.json
  commands/udlo/            # oclif entrypoints (setup / teardown / status)
force-app/.../connectedApps/  # UDLO_Notifier Connected App metadata template
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run lint` | `tsc --noEmit` (typecheck tests + `src`) |
| `npm test` | Vitest |
| `npm run test:e2e` | Build + Salesforce / keys / Connected App / Data 360 smoke script |

## State file

Successful runs will eventually write **`.udlo-state.json`** in the working directory (resource IDs for teardown). Add it to `.gitignore` if you track secrets elsewhere (this repo already ignores it).

## References

- Implementation plan: `PLAN.md`
- Reference Lambda / ZIP: [forcedotcom/file-notifier-for-blob-store](https://github.com/forcedotcom/file-notifier-for-blob-store)
- Data Cloud API: [data-360-sdk](https://www.npmjs.com/package/data-360-sdk)
