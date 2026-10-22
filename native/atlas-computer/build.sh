#!/usr/bin/env bash
# Code Atlas: builds the native helper of Claude's computer use, one arm64
# binary the desktop app ships in its resources (Resources/atlas-computer).
#
#   native/atlas-computer/build.sh   →   native/atlas-computer/dist/atlas-computer
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$here/dist"
xcrun swiftc -O -target arm64-apple-macos13.0 \
  -o "$here/dist/atlas-computer" "$here/main.swift"
echo "Built $here/dist/atlas-computer"
