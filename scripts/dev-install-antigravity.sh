#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"
npm run dev:vsix
antigravity --install-extension "$(ls -t ./*.vsix | head -n1)" --force
