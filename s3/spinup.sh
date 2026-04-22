#!/usr/bin/env bash
# Single entrypoint for AWS IAM helpers used before `udlo-notifier udlo setup` (Data Cloud S3).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

usage() {
  cat <<'EOF'
Usage:
  spinup.sh user-policy --user <name> --bucket <name> [--policy-name <name>]
  spinup.sh role --sf-aws-account-id <id> --external-id <id> --bucket <name>
                 [--role-name <name>] [--update-only] [--skip-sf-trust-check]

Examples:
  spinup.sh user-policy --user my-iam-user --bucket my-s3-bucket
  spinup.sh role -a 123456789012 -e 'app:EXAMPLE:EXAMPLE' --bucket my-s3-bucket
  spinup.sh role -a … -e … --bucket my-s3-bucket --update-only

npm (always use -- before flags; see s3/README.md):
  npm run s3:user-policy -- --user my-iam-user --bucket my-s3-bucket
  npm run s3:spinup -- user-policy --user my-iam-user --bucket my-s3-bucket
  npm run s3:role -- -a … -e … --bucket my-s3-bucket
EOF
}

cmd="${1:-help}"
if [[ "$cmd" == "help" || "$cmd" == "-h" || "$cmd" == "--help" ]]; then
  usage
  exit 0
fi
shift || true

case "$cmd" in
  user-policy)
    exec "$ROOT/deploy-user-policy.sh" "$@"
    ;;
  role)
    exec "$ROOT/deploy-role.sh" "$@"
    ;;
  *)
    echo "Unknown command: $cmd (try: user-policy, role, help)" >&2
    exit 1
    ;;
esac
