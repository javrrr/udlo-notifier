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
| **Lambda ZIP** | Set **`UDLO_LAMBDA_ZIP_PATH`** to a local `.zip` before `sf udlo setup` (see below) |
| **Data Cloud → S3** | The plugin expects an existing S3 connection. To attach AWS IAM first, use **`s3/`** via **`npm run s3:user-policy -- --user <iam-user> --bucket <bucket>`** (note the `--` before flags) or see `s3/README.md`. |

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
| `sf udlo setup` | Full pipeline: keys → Connected App (+ optional OAuth confirm) → S3 connection → UDLO → AWS (STS, IAM, Secrets, Lambda from local **`UDLO_LAMBDA_ZIP_PATH`**) → S3 notifications. Writes `.udlo-state.json` in the **current working directory**. |
| `sf udlo teardown` | Removes S3 notifications, Lambda, secrets, IAM role; optionally deletes the UDLO; clears state. Does **not** delete the Connected App. |
| `sf udlo status` | Reads `.udlo-state.json` and probes Salesforce + AWS resources. |

Examples:

```bash
sf udlo setup -o myOrg -b my-bucket -d path/to/files -n MyDocuments
sf udlo status -o myOrg
sf udlo teardown -o myOrg --auto-approve
```

Flags: run `sf udlo setup --help` (required: `--bucket`, `--object-name`; `--directory` defaults to bucket root).

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

## Data Cloud S3 (IAM before `sf udlo setup`)

```bash
npm run s3:spinup -- help
npm run s3:user-policy -- --user my-iam-user --bucket my-s3-bucket
```

npm treats leading `-` / `--` as its own options unless you insert **`--`** before your script flags. See `s3/README.md`.

## AWS Lambda deployment package

**Required:** set **`UDLO_LAMBDA_ZIP_PATH`** to a local `.zip` on disk before running **`sf udlo setup`**. Download the published package from Salesforce’s [file-notifier-for-blob-store](https://github.com/forcedotcom/file-notifier-for-blob-store) (`cloud_function_zips/aws_lambda_function.zip`), or **build your own** from `aws_lambda_function/` (requires the `zip` CLI):

```bash
npm run lambda:zip
export UDLO_LAMBDA_ZIP_PATH="$PWD/dist/lambda-local.zip"
npm run build && sf udlo setup …
```

| Item | Value |
|------|-------|
| **`UDLO_LAMBDA_ZIP_PATH`** | **Required.** Local path to the Lambda deployment `.zip` (absolute or relative to the shell cwd when you run `sf`). |
| **Runtime** | **Python 3.11** |
| **Handler** | `unstructured_data.s3_events_handler` (must match the ZIP layout) |

If Lambda creation fails with handler or runtime errors, compare with the [file-notifier-for-blob-store](https://github.com/forcedotcom/file-notifier-for-blob-store) AWS function sources under `aws/` in that repository.

## Other environment variables

| Variable | Used by |
|----------|---------|
| `SF_UDLO_CLIENT_SECRET` | Optional Connected App **consumer secret** for the OAuth code → token exchange after browser consent (`src/salesforce/oauth.ts`) |

## Project layout (high level)

```
src/
  auth/sf-auth.ts           # resolveConnection() — lazy @salesforce/core
  aws/                      # STS, IAM role, Secrets Manager, Lambda (zip from UDLO_LAMBDA_ZIP_PATH), S3 notifications
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
