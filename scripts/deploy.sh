#!/usr/bin/env bash
# Build the static site and copy it to a Linux server.
#
# Required:
#   DEPLOY_HOST   hostname or IP (do not hard-code it here)
#   DEPLOY_USER   SSH user
# Optional:
#   DEPLOY_PATH   remote directory (default: /var/www/work-english-notes)
#   DEPLOY_SSH    extra ssh options, e.g. '-i /path/to/key'
#
# Example:
#   DEPLOY_HOST=example.invalid DEPLOY_USER=ubuntu ./scripts/deploy.sh
#
# This script never stores passwords or writes secrets into the repo.
# Prefer SSH keys. If you must use a password, export SSHPASS in your
# own shell and wrap ssh with sshpass; do not put the password in a file
# that could be committed.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${DEPLOY_HOST:?Set DEPLOY_HOST to the server hostname or IP}"
: "${DEPLOY_USER:?Set DEPLOY_USER to the SSH username}"
DEPLOY_PATH="${DEPLOY_PATH:-/var/www/work-english-notes}"
DEPLOY_SSH="${DEPLOY_SSH:-}"

python3 "$ROOT/scripts/build.py"

SSH=(ssh)
# shellcheck disable=SC2206
if [[ -n "$DEPLOY_SSH" ]]; then
  SSH=(ssh $DEPLOY_SSH)
fi

REMOTE_STAGE="/tmp/work-english-notes-site.$$"

"${SSH[@]}" "${DEPLOY_USER}@${DEPLOY_HOST}" "rm -rf '${REMOTE_STAGE}' && mkdir -p '${REMOTE_STAGE}'"
tar -C "$ROOT/site" -czf - . | "${SSH[@]}" "${DEPLOY_USER}@${DEPLOY_HOST}" "tar -C '${REMOTE_STAGE}' -xzf -"

"${SSH[@]}" "${DEPLOY_USER}@${DEPLOY_HOST}" bash -s <<EOF
set -euo pipefail
sudo mkdir -p '${DEPLOY_PATH}'
if command -v rsync >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
  sudo rsync -a --delete '${REMOTE_STAGE}/' '${DEPLOY_PATH}/'
else
  sudo rm -rf '${DEPLOY_PATH}'
  sudo mkdir -p '${DEPLOY_PATH}'
  sudo cp -a '${REMOTE_STAGE}/.' '${DEPLOY_PATH}/'
fi
sudo chown -R www-data:www-data '${DEPLOY_PATH}'
sudo find '${DEPLOY_PATH}' -type d -exec chmod 755 {} +
sudo find '${DEPLOY_PATH}' -type f -exec chmod 644 {} +
rm -rf '${REMOTE_STAGE}'
echo "Published to ${DEPLOY_PATH}"
EOF
