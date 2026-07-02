#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
VERSION_FILE="$ROOT_DIR/version.json"

current_version=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)".*/\1/p' "$VERSION_FILE")

if [ -z "$current_version" ]; then
  echo "Could not read version from $VERSION_FILE" >&2
  exit 1
fi

IFS=. read -r major minor patch <<EOF
$current_version
EOF

next_patch=$((patch + 1))
next_version="$major.$minor.$next_patch"

printf '{\n  "version": "%s"\n}\n' "$next_version" > "$VERSION_FILE"
printf '%s\n' "$next_version"
