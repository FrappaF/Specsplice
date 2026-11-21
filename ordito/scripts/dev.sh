#!/usr/bin/env bash
set -euo pipefail
ORDITO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ORDITO_ROOT"
ORDITO_NODE_VERSION="$(cat .nvmrc)"
if [[ "$(node --version)" != "v$ORDITO_NODE_VERSION" ]]; then
	echo "Select Node $ORDITO_NODE_VERSION from .nvmrc before starting Specsplice." >&2
	exit 1
fi

ordito_build_dir() {
	local current="$ORDITO_ROOT/.build/ordito-$1"
	local previous="$ORDITO_ROOT/.build/ade-$1"
	if [[ ! -e "$current" && -d "$previous" ]]; then
		printf '%s\n' "$previous"
	else
		printf '%s\n' "$current"
	fi
}

export ORDITO_NODE_EXECUTABLE="${ORDITO_NODE_EXECUTABLE:-$(node -p 'process.execPath')}"
export VSCODE_PORTABLE="$(ordito_build_dir portable)"
mkdir -p "$VSCODE_PORTABLE"
exec ./scripts/code.sh --user-data-dir="$(ordito_build_dir profile)" --extensions-dir="$(ordito_build_dir extensions)" --shared-data-dir="$(ordito_build_dir shared)" "$@"
