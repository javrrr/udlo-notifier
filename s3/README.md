# Data Cloud S3 — AWS IAM helpers

For the full pipeline (Lambda vs Data Cloud S3 principal, UDLO, Connected App), see the **Architecture** section in the repository root [`README.md`](../README.md).

These scripts run **before** **`udlo-notifier udlo setup`**: they do **not** create the Salesforce connection for you. They only attach **AWS IAM** policies (and optionally create an IAM role) so Data 360 can use **either**:

- **Access key + secret** on an **existing IAM user** (typical when org SCPs block `iam:CreateUser`), or  
- **IAM role** + **AssumeRole** (needs Salesforce’s AWS account ID in the trust `Principal` from their setup documentation).

Unstructured / UDLO flows require a working **Amazon S3** connection in Data Cloud first; see [Set up unstructured data from Amazon S3](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-awss3-udlo.html).

## One entrypoint

```bash
cd s3
chmod +x spinup.sh deploy-user-policy.sh deploy-role.sh   # once

./spinup.sh help
./spinup.sh user-policy --user my-iam-user --bucket my-s3-bucket
./spinup.sh role --sf-aws-account-id 123456789012 --external-id 'app:…' --bucket my-s3-bucket
./spinup.sh role --sf-aws-account-id … --external-id … --bucket my-s3-bucket --update-only
```

From repo root with npm, put **`--`** before any argument that starts with `-` (otherwise npm may swallow flags like `--user` or `-a`):

```bash
npm run s3:spinup -- help
npm run s3 -- help
npm run s3:user-policy -- --user my-iam-user --bucket my-s3-bucket
npm run s3:spinup -- user-policy --user my-iam-user --bucket my-s3-bucket
npm run s3:role -- -a 123456789012 -e 'app:…' --bucket my-s3-bucket
```

Or run bash directly from the repo root: `bash s3/deploy-user-policy.sh --user my-iam-user --bucket my-s3-bucket`.

## Files

| File | Purpose |
|------|---------|
| `dc-s3-permissions.template.json` | S3 actions for Data 360–style access; `BUCKET_NAME_PLACEHOLDER` is replaced at deploy time. |
| `trust.template.json` | Human reference only; `deploy-role.sh` builds trust JSON with `jq` (do not put secrets in git). |
| `deploy-user-policy.sh` | `put-user-policy` for an existing user. |
| `deploy-role.sh` | `create-role` / `update-assume-role-policy` + `put-role-policy` (needs `jq`). |

## IAM user (access key) path

```bash
./spinup.sh user-policy --user my-iam-user --bucket my-s3-bucket
aws iam create-access-key --user-name my-iam-user   # secret shown once; max 2 keys per user
```

Long options also support `=value` form, e.g. `--user=my-iam-user`.

Then create or test the **Amazon S3** connection in Data Cloud with those keys.

## IAM role (AssumeRole) path

Requires the **12-digit Salesforce AWS account ID** (not your account) and the connection **external ID** from Data Cloud. See [Prepare your Amazon S3 connection](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-awss3-prerequisites.html).

```bash
./spinup.sh role \
  --sf-aws-account-id '????????????' \
  --external-id 'from-data-cloud-connection' \
  --bucket your-bucket
```

Short flags: `-a` / `-e` / `-b` / `-r` for account, external id, bucket, role name.

If the role already exists:

```bash
./spinup.sh role -a … -e … -b your-bucket --update-only
```

## Prerequisites

- AWS CLI v2, credentials with `iam:PutUserPolicy` / `iam:CreateRole` as needed  
- `jq` for the role path (`brew install jq`)  
- `python3` for JSON validation
