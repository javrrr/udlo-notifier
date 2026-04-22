# udlo-notifier

An **sf CLI plugin** that automates setup of an **S3 → Salesforce Data Cloud** unstructured file pipeline (UDLO path): Connected App + JWT, Data Cloud connections and lake objects, AWS Lambda, Secrets Manager, and S3 event notifications.

`sf udlo setup`, `teardown`, and `status` orchestrate the pipeline end-to-end (see `PLAN.md` Phase 5). Supporting modules cover Salesforce auth, Data Cloud (`data-360-sdk`), Connected App deploy, AWS IAM/Lambda/Secrets/S3, and `.udlo-state.json`.

## Architecture

High-level flow: **your AWS account** holds the data bucket and Lambda; **Salesforce Data Cloud** reads object bytes using **separate** IAM credentials configured on the S3 connection. The Lambda only receives **S3 event metadata** and notifies Data Cloud over HTTPS; it does **not** call `s3:GetObject`.

The diagram is a **[Graphviz](https://graphviz.org/) DOT** file — **no Node/npm dependency**; you only install the Graphviz CLI if you want to render an image.

| | |
|--|--|
| **Source** | [`docs/architecture.dot`](docs/architecture.dot) |
| **How to render SVG** | `cd docs && dot -Tsvg architecture.dot -o architecture.svg` |
| **Install `dot`** | macOS: `brew install graphviz` · Ubuntu/Debian: `sudo apt install graphviz` — see [`docs/README.md`](docs/README.md) |
| **Rendered** | [`docs/architecture.svg`](docs/architecture.svg) (regenerate after editing the `.dot` file) |

![Architecture: udlo-notifier pipeline](docs/architecture.svg)

**Legend**

| Component | Role |
|-----------|------|
| **Connected App** | Identifies the integration; JWT uses consumer key (`iss`) + integration user (`sub`) + private key from Secrets Manager. |
| **Browser OAuth** | One-time (or after revoke) user consent so Core JWT access tokens can include **Data Cloud ingest** scope; JWT bearer token POST does **not** accept a `scope` query/body parameter on many orgs (`invalid_request: scope parameter not supported`). |
| **Data Cloud S3 connection** | Credentials or role that let **Salesforce** read your bucket; unrelated to the Lambda execution role. |
| **UDLO directory** | Must align with object key prefixes. The plugin sends a **trailing slash** to the Data Cloud API (e.g. `afd360/` when you pass `-d afd360`). |
| **Lambda** | Assumes execution role, reads secrets, calls Salesforce OAuth + Data Cloud ingest API, posts the **raw S3 event** (not object body). |
| **IAM for Data Cloud** | Apply via `npm run s3:user-policy` / `s3:role` — see `s3/README.md` and [Data Cloud S3 prerequisites](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-awss3-prerequisites.html). |

## Prerequisites

| Requirement | Notes |
|-------------|--------|
| **Node.js** | `>= 20` (see `package.json` `engines`) |
| **Salesforce CLI** | `sf` with a logged-in org (`sf org login web` or similar) |
| **AWS credentials** | Environment variables, shared credentials file, or `AWS_PROFILE` — whatever the AWS SDK v3 picks up |
| **OpenSSL** | Used locally to mint the X.509 cert for the Connected App (`openssl` on `PATH`) |
| **Lambda ZIP** | Set **`UDLO_LAMBDA_ZIP_PATH`** to a local `.zip` before `sf udlo setup` (see below) |
| **Data Cloud → S3** | An **Amazon S3** connection must exist (or be creatable) for your bucket. Attach **customer-side IAM** first using **`s3/`** — **`npm run s3:user-policy -- --user <iam-user> --bucket <bucket>`** (note the **`--`** before flags) or **`npm run s3:role -- …`** — see `s3/README.md`. |
| **OAuth consent** | After setup deploys the Connected App, complete the browser step and **Allow** scopes including **Manage Data Cloud Ingestion API data**. Confirm under **Setup → Connected Apps OAuth Usage**. Matches [Set up unstructured data from Amazon S3](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-awss3-udlo.html). |

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
| `sf udlo setup` | Full pipeline: keys → Connected App (+ optional OAuth confirm) → S3 connection → UDLO → AWS (STS, IAM, Secrets, Lambda from local **`UDLO_LAMBDA_ZIP_PATH`**) → S3 notifications. Writes **`.udlo-state.json`** in the **current working directory**. |
| `sf udlo teardown` | Removes S3 notifications, Lambda, secrets, IAM role; optionally deletes the UDLO; clears state. Does **not** delete the Connected App. |
| `sf udlo status` | Reads `.udlo-state.json` and probes Salesforce + AWS resources. |

Examples:

```bash
sf udlo setup -o myOrg -b my-bucket -d path/to/files -n MyDocuments
sf udlo status -o myOrg
sf udlo teardown -o myOrg --auto-approve
```

Useful flags (see `sf udlo setup --help`):

| Flag | Notes |
|------|--------|
| `--directory` / `-d` | S3 key prefix without leading/trailing slashes; **empty** = bucket root. The UDLO API receives a path **with** a trailing slash when non-empty. |
| `--refresh-connected-app` | Redeploy Connected App metadata (cert, policies). Use after template or org policy changes. |
| `--auto-approve` | Skips the OAuth browser confirmation prompt (still recommended to complete consent once). |

Required: **`--bucket`**, **`--object-name`**.

## End-to-end preflight (Salesforce + keys + Connected App + Data 360 probe)

```bash
npm run test:e2e
# optional: target org alias
npm run test:e2e -- myOrgAlias
```

| Variable | Purpose |
|----------|---------|
| `UDLO_E2E_SKIP_DATA360` | Set to `1` to skip the Data 360 `connections.list` check |
| `UDLO_E2E_FORCE_DEPLOY` | Set to `1` to redeploy the Connected App even if it already exists |

## Data Cloud S3 (IAM before `sf udlo setup`)

Data Cloud needs **GetObject** / **ListBucket** (and related) on your bucket using credentials **you** attach to the S3 connection. That is **not** the Lambda role (which has no S3 access).

```bash
npm run s3:spinup -- help
npm run s3:user-policy -- --user my-iam-user --bucket my-s3-bucket
```

npm treats leading `-` / `--` as its own options unless you insert **`--`** before your script flags. See `s3/README.md`.

## AWS Lambda deployment package

**Required:** set **`UDLO_LAMBDA_ZIP_PATH`** to a local `.zip` on disk before running **`sf udlo setup`**. Download the published package from Salesforce’s [file-notifier-for-blob-store](https://github.com/forcedotcom/file-notifier-for-blob-store) (`cloud_function_zips/aws_lambda_function.zip`), or **build your own** from `aws_lambda_function/`:

```bash
npm run lambda:zip
export UDLO_LAMBDA_ZIP_PATH="$PWD/dist/lambda-local.zip"
npm run build && sf udlo setup …
```

| Item | Value |
|------|--------|
| **`UDLO_LAMBDA_ZIP_PATH`** | **Required.** Local path to the Lambda deployment `.zip` (absolute or relative to the shell cwd when you run `sf`). |
| **Runtime** | **Python 3.11** |
| **Handler** | `unstructured_data.s3_events_handler` (must match the ZIP layout) |

If Lambda creation fails with handler or runtime errors, compare with the [file-notifier-for-blob-store](https://github.com/forcedotcom/file-notifier-for-blob-store) AWS function sources.

## Environment variables

| Variable | Used by |
|----------|---------|
| **`UDLO_LAMBDA_ZIP_PATH`** | **Required** for `sf udlo setup` — local path to Lambda `.zip`. |
| **`UDLO_SF_JWT_AUDIENCE`** | Optional override for JWT `aud` / Core token host (`https://login.salesforce.com` vs `https://test.salesforce.com`). Defaults from org connection (`setup.ts`). |
| **`SF_UDLO_CLIENT_SECRET`** | Optional Connected App consumer secret for OAuth **authorization_code → token** exchange after browser consent (`src/salesforce/oauth.ts`). |
| **`UDLO_OAUTH_PREAUTH_SCOPE`** | Optional override for the **`/authorize`** URL scope string. Default: `api refresh_token cdp_ingest_api` (see `oauth.ts`). Widen/narrow if you hit `OAUTH_CODE_CRED_SCOPE_TOO_LONG` or org-specific limits. |

## Operational notes

1. **S3 object keys** must sit under the prefix you pass as **`--directory`**, and the **Data Cloud S3 connection** root must line up with how you configured folders in the UI (see the [UDLO S3 guide](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-awss3-udlo.html) path alignment section).
2. **`accepted: true`** on the ingest beacon means the notification was accepted; file processing in Data Cloud can lag. If nothing appears, verify **IAM on the S3 connection principal**, **file type**, and **UDLO directory** vs keys.
3. **Lambda logs** (`udlo-debug` prefix in the packaged handler) help trace Core token **`scope`**, CDP errors, and OAuth failures.

## Project layout (high level)

```
src/
  auth/sf-auth.ts           # resolveConnection() — lazy @salesforce/core
  aws/                      # STS, IAM role, Secrets Manager, Lambda (zip from UDLO_LAMBDA_ZIP_PATH), S3 notifications
  data-cloud/               # Data360Client factory, S3 connection lookup, UDLO helpers (directory trailing slash)
  salesforce/               # RSA keys, Connected App deploy/retrieve, OAuth callback on :1717
  state.ts                  # .udlo-state.json
  commands/udlo/            # oclif entrypoints (setup / teardown / status)
aws_lambda_function/        # Python Lambda source packaged by npm run lambda:zip
force-app/.../connectedApps/  # UDLO_Notifier Connected App metadata template
s3/                         # IAM policy/role helpers for Data Cloud bucket access
docs/                       # architecture.dot (+ optional generated architecture.svg)
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run lint` | `tsc --noEmit` (typecheck tests + `src`) |
| `npm test` | Vitest |
| `npm run test:e2e` | Build + Salesforce / keys / Connected App / Data 360 smoke script |
| `npm run lambda:zip` | Package `aws_lambda_function/` into `dist/lambda-local.zip` (requires `zip` CLI) |
| `npm run s3:spinup` | Shell entry to `s3/spinup.sh` |

## State file

Successful runs write **`.udlo-state.json`** in the working directory (resource IDs for teardown). This repo ignores it in `.gitignore`.

## References

- Architecture diagram (Graphviz): [`docs/architecture.dot`](docs/architecture.dot)
- Implementation plan: `PLAN.md`
- Data Cloud S3 IAM helpers: `s3/README.md`
- Reference Lambda / ZIP: [forcedotcom/file-notifier-for-blob-store](https://github.com/forcedotcom/file-notifier-for-blob-store)
- Data Cloud API: [data-360-sdk](https://www.npmjs.com/package/data-360-sdk)
- UDLO from Amazon S3: [Salesforce Developers — Set up unstructured data from Amazon S3](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-awss3-udlo.html)
