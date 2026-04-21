#!/usr/bin/env bash
# Build trust + permissions from templates and create/update an IAM role for Data 360 S3.
#
#   deploy-role.sh --sf-aws-account-id <12-digit> --external-id <id> --bucket <name> \
#       [--role-name <name>] [--update-only] [--skip-sf-trust-check]
# Prefer: ./spinup.sh role …
set -euo pipefail

command -v jq >/dev/null 2>&1 || {
  echo "jq is required (e.g. brew install jq) to build the trust JSON safely." >&2
  exit 1
}

ROOT="$(cd "$(dirname "$0")" && pwd)"

usage() {
  cat <<'EOF'
Usage:
  deploy-role.sh --sf-aws-account-id <id> --external-id <id> --bucket <name>
                 [--role-name <name>] [--update-only] [--skip-sf-trust-check]

Options:
  --sf-aws-account-id, -a   Salesforce AWS account ID for trust Principal (required; NOT your account)
  --external-id, -e        sts:ExternalId from Data Cloud S3 connection (required)
  --bucket, -b             S3 bucket name (required)
  --role-name, -r          IAM role name (default: data-cloud-s3-<bucket>)
  --update-only            Only update assume-role policy + inline policy (role must exist)
  --skip-sf-trust-check    Allow SF account id to match your account (experts only)
  -h, --help               Show this help

Example:
  deploy-role.sh -a 123456789012 -e 'app:EXAMPLE:EXAMPLE' --bucket my-s3-bucket
EOF
}

SF_AWS_ACCOUNT_ID=""
DC_EXTERNAL_ID=""
MY_BUCKET=""
ROLE_NAME=""
UPDATE_ONLY=false
SKIP_SF_TRUST_CHECK=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --sf-aws-account-id=*)
      SF_AWS_ACCOUNT_ID="${1#*=}"
      shift
      ;;
    --external-id=*)
      DC_EXTERNAL_ID="${1#*=}"
      shift
      ;;
    --bucket=*)
      MY_BUCKET="${1#*=}"
      shift
      ;;
    --role-name=*)
      ROLE_NAME="${1#*=}"
      shift
      ;;
    --sf-aws-account-id | -a)
      [[ $# -ge 2 ]] || {
        echo "error: $1 requires a value" >&2
        exit 1
      }
      SF_AWS_ACCOUNT_ID="$2"
      shift 2
      ;;
    --external-id | -e)
      [[ $# -ge 2 ]] || {
        echo "error: $1 requires a value" >&2
        exit 1
      }
      DC_EXTERNAL_ID="$2"
      shift 2
      ;;
    --bucket | -b)
      [[ $# -ge 2 ]] || {
        echo "error: $1 requires a value" >&2
        exit 1
      }
      MY_BUCKET="$2"
      shift 2
      ;;
    --role-name | -r)
      [[ $# -ge 2 ]] || {
        echo "error: $1 requires a value" >&2
        exit 1
      }
      ROLE_NAME="$2"
      shift 2
      ;;
    --update-only)
      UPDATE_ONLY=true
      shift
      ;;
    --skip-sf-trust-check)
      SKIP_SF_TRUST_CHECK=true
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$SF_AWS_ACCOUNT_ID" || -z "$DC_EXTERNAL_ID" || -z "$MY_BUCKET" ]]; then
  echo "error: --sf-aws-account-id, --external-id, and --bucket are required" >&2
  usage >&2
  exit 1
fi

if [[ -z "$ROLE_NAME" ]]; then
  ROLE_NAME="data-cloud-s3-${MY_BUCKET}"
fi

MY_ACCOUNT="$(aws sts get-caller-identity --query Account --output text 2>/dev/null || true)"
if $SKIP_SF_TRUST_CHECK; then
  :
elif [[ -n "$MY_ACCOUNT" && "$SF_AWS_ACCOUNT_ID" == "$MY_ACCOUNT" ]]; then
  echo "error: --sf-aws-account-id (${SF_AWS_ACCOUNT_ID}) equals YOUR current AWS account." >&2
  echo "  Data Cloud calls sts:AssumeRole from Salesforce infrastructure; the trust Principal must be" >&2
  echo "  Salesforce's AWS account ID from their Data 360 S3 setup doc / sample trust policy — not ${MY_ACCOUNT}." >&2
  echo "  Re-run with the correct id, or pass --skip-sf-trust-check only if you know what you are doing." >&2
  exit 1
fi

TRUST_JSON="$(mktemp)"
PERMS_JSON="$(mktemp)"
cleanup() {
  rm -f "$TRUST_JSON" "$PERMS_JSON"
}
trap cleanup EXIT

jq -n \
  --arg a "$SF_AWS_ACCOUNT_ID" \
  --arg e "$DC_EXTERNAL_ID" \
  '{
    Version: "2012-10-17",
    Statement: [{
      Effect: "Allow",
      Principal: { AWS: ("arn:aws:iam::" + $a + ":root") },
      Action: "sts:AssumeRole",
      Condition: { StringEquals: { "sts:ExternalId": $e } }
    }]
  }' >"$TRUST_JSON"

sed "s/BUCKET_NAME_PLACEHOLDER/${MY_BUCKET}/g" "$ROOT/dc-s3-permissions.template.json" >"$PERMS_JSON"

python3 -m json.tool "$TRUST_JSON" >/dev/null
python3 -m json.tool "$PERMS_JSON" >/dev/null

if $UPDATE_ONLY; then
  aws iam update-assume-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-document "file://$TRUST_JSON"
else
  aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document "file://$TRUST_JSON"
fi

aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name "DataCloudS3RoleAccess" \
  --policy-document "file://$PERMS_JSON"

echo "Role ARN (paste into Data Cloud):"
aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text
