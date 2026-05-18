#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

BACKUP_REPO_URL="${CODEX_BACKUPS_URL:-https://github.com/UntLab/codex.git}"
BACKUP_BRANCH="${CODEX_BACKUPS_BRANCH:-main}"

origin_url="$(git -C "$REPO_ROOT" config --get remote.origin.url || true)"
default_project_name="$(basename "${origin_url:-$REPO_ROOT}")"
default_project_name="${default_project_name%.git}"
PROJECT_NAME="${1:-${CODEX_BACKUP_PROJECT:-$default_project_name}}"

if [[ -z "$PROJECT_NAME" ]]; then
  echo "Could not determine project name for backup." >&2
  exit 1
fi

tmp_root="$(mktemp -d "${TMPDIR:-/tmp}/codex-backups-XXXXXX")"
cleanup() {
  rm -rf "$tmp_root"
}
trap cleanup EXIT

backup_checkout="$tmp_root/codex-backups"
target_dir="$backup_checkout/$PROJECT_NAME"

echo "Cloning $BACKUP_REPO_URL#$BACKUP_BRANCH ..."
git clone --depth 1 --branch "$BACKUP_BRANCH" "$BACKUP_REPO_URL" "$backup_checkout" >/dev/null

rm -rf "$target_dir"
mkdir -p "$target_dir"

echo "Exporting tracked files from $REPO_ROOT ..."
git -C "$REPO_ROOT" archive --format=tar HEAD | tar -xf - -C "$target_dir"

git -C "$backup_checkout" add --all "$PROJECT_NAME"

if git -C "$backup_checkout" diff --cached --quiet -- "$PROJECT_NAME"; then
  echo "No backup changes detected for $PROJECT_NAME."
  exit 0
fi

source_commit="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
source_branch="$(git -C "$REPO_ROOT" branch --show-current || echo detached)"

git -C "$backup_checkout" commit -m "Backup $PROJECT_NAME from $source_branch@$source_commit" >/dev/null

echo "Pushing backup to $BACKUP_REPO_URL ..."
git -C "$backup_checkout" push origin "$BACKUP_BRANCH"

echo "Backup complete: $PROJECT_NAME -> $BACKUP_REPO_URL ($BACKUP_BRANCH)"
