#!/usr/bin/env bash
# Build valveoff-bundle.tar.gz for the GitHub release asset.
# Requires the full "ValveOFF 1.4" folder (with install.sh, bin/, hammer-decky/, etc.)
# at ../Downloads/ValveOFF 1.4 or pass BUNDLE_ROOT=/path/to/ValveOFF\ 1.4
set -euo pipefail

HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
BUNDLE_ROOT="${BUNDLE_ROOT:-$HOME/Downloads/ValveOFF 1.4}"
DIRNAME="$(basename "$BUNDLE_ROOT")"
PARENT="$(dirname "$BUNDLE_ROOT")"
OUT="$HERE/valveoff-bundle.tar.gz"

[ -f "$BUNDLE_ROOT/install.sh" ] || {
	echo "[ERR] install.sh not found in $BUNDLE_ROOT" >&2
	echo "      Set BUNDLE_ROOT to your extracted ValveOFF 1.4 folder." >&2
	exit 1
}

if grep -q 'React\.createElement' "$BUNDLE_ROOT/hammer-decky/dist/index.js" 2>/dev/null; then
	echo "[ERR] hammer-decky dist in bundle still uses React.createElement — rebuild plugin first." >&2
	exit 1
fi

echo "[..] Packing '$DIRNAME' → $OUT"
rm -f "$OUT"
tar -czf "$OUT" \
	--exclude="$DIRNAME/hammer-decky/node_modules" \
	--exclude="$DIRNAME/hammer-decky/src" \
	--exclude="$DIRNAME/.git" \
	-C "$PARENT" "$DIRNAME"
du -h "$OUT"
echo "[OK] Upload: gh release upload valveoff-1.4 $OUT --clobber"
