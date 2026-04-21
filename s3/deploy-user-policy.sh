#!/usr/bin/env bash
# Attach S3 inline policy to an existing IAM user (Data 360 access-key auth).
# Uses dc-s3-permissions.template.json (ingestion + activation style S3 actions).
#
#   deploy-user-policy.sh --user <name> --bucket <name> [--policy-name <name>]
# Prefer: ./spinup.sh user-policy --user … --bucket …
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

usage() {
  cat <<'EOF'
Usage:
  deploy-user-policy.sh --user <iam-user-name> --bucket <bucket-name> [--policy-name <name>]

Options:
  --user, -u       IAM user name (required)
  --bucket, -b     S3 bucket name (required)
  --policy-name    Inline policy name (default: DataCloudS3UserAccess)
  -h, --help       Show this help

Example:
  deploy-user-policy.sh --user my-iam-user --bucket my-s3-bucket
EOF
}

IAM_USER=""
MY_BUCKET=""
POLICY_NAME="DataCloudS3UserAccess"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --user=*)
      IAM_USER="${1#*=}"
      shift
      ;;
    --bucket=*)
      MY_BUCKET="${1#*=}"
      shift
      ;;
    --policy-name=*)
      POLICY_NAME="${1#*=}"
      shift
      ;;
    --user | -u)
      [[ $# -ge 2 ]] || {
        echo "error: $1 requires a value" >&2
        exit 1
      }
      IAM_USER="$2"
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
    --policy-name)
      [[ $# -ge 2 ]] || {
        echo "error: $1 requires a value" >&2
        exit 1
      }
      POLICY_NAME="$2"
      shift 2
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

if [[ -z "$IAM_USER" || -z "$MY_BUCKET" ]]; then
  echo "error: --user and --bucket are required" >&2
  usage >&2
  exit 1
fi

PERMS_JSON="$(mktemp)"
trap 'rm -f "$PERMS_JSON"' EXIT

sed "s/BUCKET_NAME_PLACEHOLDER/${MY_BUCKET}/g" "$ROOT/dc-s3-permissions.template.json" >"$PERMS_JSON"
python3 -m json.tool "$PERMS_JSON" >/dev/null

aws iam put-user-policy \
  --user-name "$IAM_USER" \
  --policy-name "$POLICY_NAME" \
  --policy-document "file://$PERMS_JSON"

echo "Inline policy ${POLICY_NAME} attached to ${IAM_USER} for s3://${MY_BUCKET}/"
echo "Next: create or rotate access keys if needed:"
echo "  aws iam list-access-keys --user-name \"${IAM_USER}\""
echo "  aws iam create-access-key --user-name \"${IAM_USER}\""
