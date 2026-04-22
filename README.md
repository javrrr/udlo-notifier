# udlo-notifier

CLI that wires an S3 bucket to a Salesforce Data Cloud **UDLO** (Unstructured Data Lake Object): deploys a Connected App, a Lambda (Node.js, zero dependencies besides the AWS SDK that's bundled in the runtime), Secrets Manager entries, and an S3 event notification. When objects land in the bucket, the Lambda posts the S3 event to the Data Cloud ingest beacon.

**This tool does not create the UDLO or the Data Cloud S3 connection.** Both must exist in the Data Cloud UI first.

## Prerequisites

| Tool | Why |
|---|---|
| Node.js ≥ 20 | Runs the CLI |
| `sf` CLI with a logged-in org | Deploys Connected App metadata |
| AWS credentials | Env vars, `AWS_PROFILE`, or `--aws-profile` |
| `openssl` on PATH | Generates the JWT cert |

**Before running:** in Data Cloud, create an **Amazon S3 connection** pointing at your bucket and a **UDLO** that uses it. Note the connection **Name** or **API Name** (Setup → Data Cloud → Connections).

## Data Cloud → S3 IAM (customer side)

Data Cloud reads object bytes using its own credentials, **not** the Lambda role. Attach an inline policy to an IAM user or role (whichever the S3 connection uses):

```bash
cat > dc-policy.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["s3:ListBucket", "s3:GetBucketLocation"], "Resource": "arn:aws:s3:::YOUR-BUCKET" },
    { "Effect": "Allow", "Action": ["s3:GetObject", "s3:GetObjectVersion"], "Resource": "arn:aws:s3:::YOUR-BUCKET/*" }
  ]
}
EOF

# Access-key path:
aws iam put-user-policy --user-name <iam-user> --policy-name DataCloudS3 --policy-document file://dc-policy.json

# AssumeRole path (use Salesforce's AWS account ID from Data Cloud docs and the external ID from the S3 connection):
aws iam create-role --role-name data-cloud-s3 --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"AWS":"arn:aws:iam::<sf-account>:root"},"Action":"sts:AssumeRole","Condition":{"StringEquals":{"sts:ExternalId":"<external-id>"}}}]}'
aws iam put-role-policy --role-name data-cloud-s3 --policy-name DataCloudS3 --policy-document file://dc-policy.json
```

## Install

As a dev dependency in a Salesforce DX project:

```json
{
  "devDependencies": { "udlo-notifier": "^0.2.0" },
  "scripts": {
    "udlo:setup": "udlo-notifier udlo setup -o myOrg -b my-bucket -n MyUdlo__dll -c MyS3Connection",
    "udlo:status": "udlo-notifier udlo status",
    "udlo:teardown": "udlo-notifier udlo teardown"
  }
}
```

Run from the DX project root. All artifacts go under `.udlo-notifier/` (state + keys); add that to `.gitignore`.

## Commands

```bash
udlo-notifier udlo setup -o <org> -b <bucket> -n <udlo-name> -c <s3-connection-name> [-d <prefix>]
udlo-notifier udlo status
udlo-notifier udlo teardown
```

**Deleting UDLO records:** the S3 notification forwards both `ObjectCreated:*` and `ObjectRemoved:*` events to Data Cloud, so `aws s3 rm s3://<bucket>/<key>` removes both the file and the corresponding UDLO row. Row deletion in Data Cloud is asynchronous (typically 1–3 minutes).

| Flag | Notes |
|---|---|
| `-o, --target-org` | Salesforce alias or username (defaults to `sf config get target-org`) |
| `-b, --bucket` | S3 bucket (required) |
| `-n, --object-name` | UDLO API name including `__dll` suffix, e.g. `my_udlo__dll` (must already exist; required) |
| `-c, --s3-connection` | Data Cloud S3 connection Name or API Name (required on first run; saved to state) |
| `-d, --directory` | S3 key prefix (no leading/trailing slash); empty = bucket root |
| `--aws-region` | Defaults to `us-east-1` |
| `--aws-profile` | Named profile from `~/.aws/credentials` |

On first setup, the CLI deploys the `UDLO_Notifier` Connected App and opens a browser for OAuth consent. Approve the scopes (including *Manage Data Cloud Ingestion API data*). Subsequent runs reuse the existing app.

## What it creates

| Resource | Name |
|---|---|
| Salesforce Connected App | `UDLO_Notifier` |
| AWS IAM role | `udlo-notifier-<suffix>-role` |
| AWS Secrets Manager | `udlo-notifier-<suffix>-consumer-key`, `udlo-notifier-<suffix>-rsa-key` |
| AWS Lambda (Node.js 20) | `udlo-notifier-<suffix>-fn` |
| S3 notification | `s3:ObjectCreated:*` → Lambda, prefix-filtered |

The Lambda holds only an execution role for CloudWatch Logs + `secretsmanager:GetSecretValue` on its two secrets. It does **not** call `s3:GetObject` — Data Cloud reads object bytes directly using the IAM principal you attached to the S3 connection.

## Environment variables

None required. The Lambda reads its config from env vars set at deploy time:

- `SF_LOGIN_URL` — OAuth host (`https://login.salesforce.com` or `.../test...`)
- `SF_USERNAME` — integration user
- `CONSUMER_KEY`, `RSA_PRIVATE_KEY` — Secrets Manager secret **names**

## Teardown

```bash
udlo-notifier udlo teardown
```

Deletes the Lambda, IAM role, secrets, S3 notification, and the local `.udlo-notifier/` workspace. Leaves the Connected App and UDLO in place — remove them from the Salesforce UI if needed.
