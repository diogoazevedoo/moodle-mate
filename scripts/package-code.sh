#!/usr/bin/env bash
# package-code.sh — zip a code deliverable for submission.
#
# Usage:
#   package-code.sh <dir> <assignment-id>
#
# Produces <dir>/../<assignment-id>.zip (next to <dir>) with common noise
# excluded. Echoes the archive path. NEVER submits — review and upload yourself.

set -euo pipefail

DIR="${1:-}"
ASSIGNMENT_ID="${2:-}"

if [[ -z "$DIR" || -z "$ASSIGNMENT_ID" ]]; then
  echo "usage: package-code.sh <dir> <assignment-id>" >&2
  exit 2
fi
if [[ ! -d "$DIR" ]]; then
  echo "error: directory not found: $DIR" >&2
  exit 1
fi
if ! command -v zip >/dev/null 2>&1; then
  echo "error: zip is not installed or not on PATH" >&2
  exit 1
fi

SRC_DIR="$(cd "$DIR" && pwd)"
PARENT_DIR="$(dirname "$SRC_DIR")"
BASE_NAME="$(basename "$SRC_DIR")"
ZIP_PATH="$PARENT_DIR/$ASSIGNMENT_ID.zip"

rm -f "$ZIP_PATH"

EXCLUDES=(
  "*/.git/*" "*/node_modules/*" "*/venv/*" "*/.venv/*" "*/__pycache__/*"
  "*/build/*" "*/dist/*" "*/target/*" "*/.next/*" "*/.cache/*"
  "*/.pytest_cache/*" "*/.mypy_cache/*"
  "*.pyc" "*.pyo" "*.class" "*.o" "*.log" "*.DS_Store"
)

cd "$PARENT_DIR"
zip -r -q "$ZIP_PATH" "$BASE_NAME" -x "${EXCLUDES[@]}"

echo "Created: $ZIP_PATH"
echo "REMINDER: review the contents of this archive before submitting it yourself in Moodle."
echo "          Nothing has been uploaded — submission is a manual, human step."
